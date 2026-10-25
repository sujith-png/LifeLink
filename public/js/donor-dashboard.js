// Donor Dashboard View Logic
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('dash-availability-toggle');
  if (toggle) {
    toggle.addEventListener('change', async (e) => {
      const isChecked = e.target.checked;
      try {
        const res = await API.request('/api/donors/availability', {
          method: 'PATCH',
          body: JSON.stringify({ is_available: isChecked })
        });
        showToast(res.message, isChecked ? 'success' : 'info');
        updateDonorUI(res.donor);
      } catch (err) {
        showToast(err.message || 'Failed to update availability.', 'error');
        e.target.checked = !isChecked; // revert
      }
    });
  }

  const recordBtn = document.getElementById('btn-record-donation');
  if (recordBtn) {
    recordBtn.addEventListener('click', async () => {
      const dateInput = prompt('Enter donation date (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
      if (!dateInput) return;

      try {
        const res = await API.request('/api/donors/record-donation', {
          method: 'POST',
          body: JSON.stringify({ date: dateInput })
        });
        showToast('Donation recorded! Eligibility status updated.', 'success');
        updateDonorUI(res.donor);
      } catch (err) {
        showToast(err.message || 'Failed to record donation.', 'error');
      }
    });
  }

  const editProfileForm = document.getElementById('edit-donor-profile-form');
  if (editProfileForm) {
    editProfileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        name: document.getElementById('dash-edit-name').value.trim(),
        phone: document.getElementById('dash-edit-phone').value.trim(),
        city: document.getElementById('dash-edit-city').value.trim(),
        area_pincode: document.getElementById('dash-edit-pincode').value.trim(),
        last_donation_date: document.getElementById('dash-edit-last-donation').value || null
      };

      try {
        const res = await API.request('/api/donors/profile', {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        showToast('Profile updated successfully!', 'success');
        updateDonorUI(res.donor);
        closeModal('edit-profile-modal');
      } catch (err) {
        showToast(err.message || 'Failed to update profile.', 'error');
      }
    });
  }

  window.addEventListener('lifelink:view-changed', (e) => {
    if (e.detail?.view === 'donor-dashboard') {
      loadDonorProfile();
    }
  });
});

async function loadDonorProfile() {
  const user = API.getUser();
  if (!user || user.role !== 'donor') {
    showToast('Please log in with a donor account.', 'warning');
    showView('home');
    return;
  }

  try {
    const res = await API.request('/api/donors/profile');
    updateDonorUI(res.donor);
  } catch (err) {
    showToast(err.message || 'Failed to load donor profile.', 'error');
  }
}

function updateDonorUI(donor) {
  if (!donor) return;

  // Header and info
  const nameEl = document.getElementById('dash-donor-name');
  const bloodEl = document.getElementById('dash-blood-badge');
  const cityEl = document.getElementById('dash-donor-location');
  const phoneEl = document.getElementById('dash-donor-phone');
  const lastDonEl = document.getElementById('dash-last-donation-text');
  const toggle = document.getElementById('dash-availability-toggle');
  const statusLabel = document.getElementById('dash-availability-label');

  if (nameEl) nameEl.textContent = donor.name;
  if (bloodEl) bloodEl.textContent = donor.blood_group;
  if (cityEl) cityEl.textContent = `${donor.city} (PIN: ${donor.area_pincode || 'N/A'})`;
  if (phoneEl) phoneEl.textContent = donor.phone;
  if (lastDonEl) lastDonEl.textContent = donor.last_donation_date ? donor.last_donation_date : 'No previous donation recorded';

  if (toggle) toggle.checked = Boolean(donor.is_available);
  if (statusLabel) {
    statusLabel.textContent = donor.is_available ? 'Available for Emergency Alerts' : 'Unavailable / On Standby';
    statusLabel.style.color = donor.is_available ? 'var(--success)' : 'var(--text-muted)';
  }

  // Eligibility block
  const eligBox = document.getElementById('dash-eligibility-box');
  const eligIcon = document.getElementById('dash-eligibility-icon');
  const eligTitle = document.getElementById('dash-eligibility-title');
  const eligDesc = document.getElementById('dash-eligibility-desc');

  const elig = donor.eligibility;
  if (elig && eligBox) {
    if (elig.isEligible) {
      eligBox.className = 'eligibility-box eligible';
      eligIcon.textContent = '🩸';
      eligTitle.textContent = 'Active & Medically Eligible';
      eligDesc.textContent = 'You are ready to receive immediate alerts for patients in need.';
    } else {
      eligBox.className = 'eligibility-box ineligible';
      eligIcon.textContent = '⏳';
      eligTitle.textContent = 'Currently Ineligible for Donation';
      eligDesc.textContent = elig.reason || 'You are in the cooldown period or availability is OFF.';
    }
  }

  // Pre-fill edit modal form fields
  const editName = document.getElementById('dash-edit-name');
  const editPhone = document.getElementById('dash-edit-phone');
  const editCity = document.getElementById('dash-edit-city');
  const editPincode = document.getElementById('dash-edit-pincode');
  const editLastDonation = document.getElementById('dash-edit-last-donation');

  if (editName) editName.value = donor.name;
  if (editPhone) editPhone.value = donor.phone;
  if (editCity) editCity.value = donor.city;
  if (editPincode) editPincode.value = donor.area_pincode || '';
  if (editLastDonation) editLastDonation.value = donor.last_donation_date || '';
}
