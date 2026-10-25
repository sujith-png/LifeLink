// Authentication & Session Management
let selectedBloodGroup = '';

document.addEventListener('DOMContentLoaded', async () => {
  initAuthUI();
  initPasswordToggles();
  checkAuthSession();
});

/**
 * Eye Button Password Visibility Toggle
 * Toggles password input type between 'password' and 'text'.
 * Never submits forms or triggers validation.
 */
function initPasswordToggles() {
  document.querySelectorAll('.password-toggle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const wrapper = btn.closest('.password-input-wrapper');
      if (!wrapper) return;
      const input = wrapper.querySelector('input');
      if (!input) return;

      const eyeOpen = btn.querySelector('.eye-open');
      const eyeClosed = btn.querySelector('.eye-closed');

      if (input.type === 'password') {
        input.type = 'text';
        btn.setAttribute('aria-label', 'Hide password');
        btn.setAttribute('title', 'Hide password');
        if (eyeOpen) eyeOpen.style.display = 'none';
        if (eyeClosed) eyeClosed.style.display = 'inline';
      } else {
        input.type = 'password';
        btn.setAttribute('aria-label', 'Show password');
        btn.setAttribute('title', 'Show password');
        if (eyeOpen) eyeOpen.style.display = 'inline';
        if (eyeClosed) eyeClosed.style.display = 'none';
      }
    });
  });
}

function initAuthUI() {
  // Blood group selector chips
  const bloodChips = document.querySelectorAll('.blood-chip');
  bloodChips.forEach(chip => {
    chip.addEventListener('click', () => {
      bloodChips.forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      selectedBloodGroup = chip.getAttribute('data-group');
      const hiddenInput = document.getElementById('reg-blood-group');
      if (hiddenInput) hiddenInput.value = selectedBloodGroup;
    });
  });

  // Role toggle in registration form
  const roleDonorRadio = document.getElementById('role-donor');
  const roleRequesterRadio = document.getElementById('role-requester');
  const donorFields = document.getElementById('donor-specific-fields');

  if (roleDonorRadio && roleRequesterRadio && donorFields) {
    const updateRoleFields = () => {
      if (roleDonorRadio.checked) {
        donorFields.style.display = 'block';
      } else {
        donorFields.style.display = 'none';
      }
    };
    roleDonorRadio.addEventListener('change', updateRoleFields);
    roleRequesterRadio.addEventListener('change', updateRoleFields);
  }

  // Geolocation button
  const geoBtn = document.getElementById('btn-get-location');
  if (geoBtn) {
    geoBtn.addEventListener('click', () => {
      if (!navigator.geolocation) {
        showToast('Geolocation is not supported by your browser.', 'warning');
        return;
      }
      geoBtn.disabled = true;
      geoBtn.innerText = 'Detecting...';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          document.getElementById('reg-lat').value = pos.coords.latitude.toFixed(6);
          document.getElementById('reg-lng').value = pos.coords.longitude.toFixed(6);
          geoBtn.disabled = false;
          geoBtn.innerText = '📍 Location Found';
          showToast('GPS coordinates captured accurately.', 'success');
        },
        (err) => {
          geoBtn.disabled = false;
          geoBtn.innerText = '📍 Auto-detect GPS';
          showToast(`Location access: ${err.message}`, 'warning');
        },
        { timeout: 10000, enableHighAccuracy: true }
      );
    });
  }

  // Register Form Submit
  const registerForm = document.getElementById('register-form');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = registerForm.querySelector('button[type="submit"]');

      const role = document.querySelector('input[name="role"]:checked')?.value || 'donor';
      const email = document.getElementById('reg-email').value.trim();
      const password = document.getElementById('reg-password').value;
      const confirmPassword = document.getElementById('reg-confirm-password')?.value;

      // Validate Password Match
      if (confirmPassword !== undefined && password !== confirmPassword) {
        showToast('Passwords do not match. Please re-enter your password.', 'error');
        document.getElementById('reg-confirm-password').focus();
        return;
      }

      const payload = { email, password, role };

      if (role === 'donor') {
        payload.name = document.getElementById('reg-name').value.trim();
        payload.phone = document.getElementById('reg-phone').value.trim();
        payload.blood_group = document.getElementById('reg-blood-group').value;
        payload.city = document.getElementById('reg-city').value.trim();
        payload.area_pincode = document.getElementById('reg-pincode').value.trim();
        payload.latitude = document.getElementById('reg-lat').value || null;
        payload.longitude = document.getElementById('reg-lng').value || null;
        payload.last_donation_date = document.getElementById('reg-last-donation').value || null;
        payload.is_available = document.getElementById('reg-available').checked ? 1 : 0;

        if (!payload.name || payload.name.length < 2) {
          showToast('Please provide your full name.', 'warning');
          document.getElementById('reg-name').focus();
          return;
        }

        if (!payload.blood_group) {
          showToast('Please select your blood group.', 'warning');
          return;
        }

        // Validate Indian phone number format
        let clean10 = payload.phone.replace(/[\s\-.()]/g, '');
        if (clean10.startsWith('+91')) clean10 = clean10.slice(3);
        else if (clean10.startsWith('91') && clean10.length === 12) clean10 = clean10.slice(2);
        else if (clean10.startsWith('0') && clean10.length === 11) clean10 = clean10.slice(1);

        if (!/^[6-9]\d{9}$/.test(clean10)) {
          showToast('Please provide a valid 10-digit Indian mobile number.', 'warning');
          document.getElementById('reg-phone').focus();
          return;
        }

        if (!payload.city || payload.city.length < 2) {
          showToast('Please provide your city.', 'warning');
          document.getElementById('reg-city').focus();
          return;
        }

        if (!payload.area_pincode || payload.area_pincode.length < 2) {
          showToast('Please provide your area or pincode.', 'warning');
          document.getElementById('reg-pincode').focus();
          return;
        }
      }

      submitBtn.disabled = true;
      submitBtn.innerText = 'Creating account...';

      try {
        const res = await API.request('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        API.setToken(res.token);
        API.setUser({ ...res.user, donor: res.donor });

        showToast('Registration successful! Welcome to LifeLink.', 'success');
        closeModal('register-modal');
        registerForm.reset();
        updateNavState();

        if (res.user.role === 'donor') {
          showView('donor-dashboard');
        } else {
          showView('home');
        }
      } catch (err) {
        showToast(err.message || 'Registration failed.', 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Complete Registration';
      }
    });
  }

  // Login Form Submit (supports Email Address or Mobile Phone)
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = loginForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.innerText = 'Signing in...';

      const identifier = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;

      try {
        const res = await API.request('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ identifier, email: identifier, password })
        });

        API.setToken(res.token);
        API.setUser({ ...res.user, donor: res.donor });

        showToast('Logged in successfully!', 'success');
        closeModal('login-modal');
        loginForm.reset();
        updateNavState();

        if (res.user.role === 'donor') {
          showView('donor-dashboard');
        } else if (res.user.role === 'admin') {
          showView('admin-dashboard');
        } else {
          showView('home');
        }
      } catch (err) {
        showToast(err.message || 'Invalid email/phone or password. Please try again.', 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Log In';
      }
    });
  }

  // Logout Button
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      API.clearSession();
      showToast('Logged out successfully.', 'info');
      updateNavState();
      showView('home');
    });
  }
}

async function checkAuthSession() {
  const token = API.getToken();
  if (!token) {
    updateNavState();
    return;
  }

  try {
    const res = await API.request('/api/auth/me');
    API.setUser({ ...res.user, donor: res.donor });
    updateNavState();
  } catch (err) {
    API.clearSession();
    updateNavState();
  }
}

function updateNavState() {
  const user = API.getUser();
  const guestNav = document.getElementById('nav-guest-actions');
  const userNav = document.getElementById('nav-user-actions');
  const userGreeting = document.getElementById('nav-user-greeting');
  const donorLink = document.getElementById('nav-link-donor-dashboard');
  const adminLink = document.getElementById('nav-link-admin');

  if (user) {
    if (guestNav) guestNav.style.display = 'none';
    if (userNav) userNav.style.display = 'flex';
    if (userGreeting) {
      const displayName = user.donor?.name || user.email.split('@')[0];
      userGreeting.textContent = `${displayName} (${user.role.toUpperCase()})`;
    }

    if (donorLink) donorLink.style.display = user.role === 'donor' ? 'inline-block' : 'none';
    if (adminLink) adminLink.style.display = user.role === 'admin' ? 'inline-block' : 'none';
  } else {
    if (guestNav) guestNav.style.display = 'flex';
    if (userNav) userNav.style.display = 'none';
    if (donorLink) donorLink.style.display = 'none';
    if (adminLink) adminLink.style.display = 'none';
  }

  window.dispatchEvent(new CustomEvent('lifelink:session-updated', { detail: { user } }));
}
