// Emergency Request Posting Client
let selectedRequestBloodGroup = '';
let selectedUrgency = 'Urgent';

document.addEventListener('DOMContentLoaded', () => {
  initPostRequestUI();
});

function initPostRequestUI() {
  // Blood group selector chips for request modal
  const reqBloodChips = document.querySelectorAll('.req-blood-chip');
  reqBloodChips.forEach(chip => {
    chip.addEventListener('click', () => {
      reqBloodChips.forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      selectedRequestBloodGroup = chip.getAttribute('data-group');
      const hiddenInput = document.getElementById('req-blood-group');
      if (hiddenInput) hiddenInput.value = selectedRequestBloodGroup;
    });
  });

  // Urgency level buttons
  const urgencyBtns = document.querySelectorAll('.urgency-btn');
  urgencyBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      urgencyBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedUrgency = btn.getAttribute('data-urgency');
      const hiddenUrgency = document.getElementById('req-urgency');
      if (hiddenUrgency) hiddenUrgency.value = selectedUrgency;
    });
  });

  // Default needed-by time: 24 hours from now
  const neededByInput = document.getElementById('req-needed-by');
  if (neededByInput && !neededByInput.value) {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const tzOffset = tomorrow.getTimezoneOffset() * 60000;
    const localISOTime = new Date(tomorrow.getTime() - tzOffset).toISOString().slice(0, 16);
    neededByInput.value = localISOTime;
  }

  // Geolocation button for request
  const geoBtn = document.getElementById('btn-get-req-location');
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
          document.getElementById('req-lat').value = pos.coords.latitude.toFixed(6);
          document.getElementById('req-lng').value = pos.coords.longitude.toFixed(6);
          geoBtn.disabled = false;
          geoBtn.innerText = '📍 Location Found';
          showToast('GPS coordinates attached to request.', 'success');
        },
        (err) => {
          geoBtn.disabled = false;
          geoBtn.innerText = '📍 Auto-detect GPS';
          showToast(`Location error: ${err.message}`, 'warning');
        },
        { timeout: 10000, enableHighAccuracy: true }
      );
    });
  }

  // --- COMPULSORY REQUISITION SLIP DROPZONE & FILE PREVIEW ---
  const dropzone = document.getElementById('slip-upload-dropzone');
  const fileInput = document.getElementById('req-file-slip');
  const promptEl = document.getElementById('slip-upload-prompt');
  const previewEl = document.getElementById('slip-file-preview');
  const fileNameEl = document.getElementById('slip-file-name');
  const fileSizeEl = document.getElementById('slip-file-size');
  const fileIconEl = document.getElementById('slip-file-icon');
  const btnRemove = document.getElementById('btn-remove-slip');
  const errorMsgEl = document.getElementById('slip-error-msg');

  function showSlipError(msg) {
    if (errorMsgEl) {
      errorMsgEl.textContent = msg;
      errorMsgEl.style.display = 'block';
    }
    if (dropzone) {
      dropzone.style.border = '2px solid var(--danger)';
      dropzone.style.background = '#fef2f2';
    }
  }

  function clearSlipError() {
    if (errorMsgEl) {
      errorMsgEl.textContent = '';
      errorMsgEl.style.display = 'none';
    }
    if (dropzone) {
      dropzone.style.border = '2px dashed #cbd5e1';
      dropzone.style.background = '#f8fafc';
    }
  }

  function resetSlipUI() {
    if (promptEl) promptEl.style.display = 'block';
    if (previewEl) previewEl.style.display = 'none';
    if (fileNameEl) fileNameEl.textContent = '';
    if (fileSizeEl) fileSizeEl.textContent = '';
  }

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', (e) => {
      if (e.target.closest('#btn-remove-slip')) return;
      fileInput.click();
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) {
        resetSlipUI();
        return;
      }

      // Check allowed extensions
      const allowedExts = ['.pdf', '.jpg', '.jpeg', '.png'];
      const rawExt = '.' + file.name.split('.').pop().toLowerCase();
      if (!allowedExts.includes(rawExt)) {
        showSlipError('Invalid file format. Only PDF, JPG, JPEG, and PNG files are allowed.');
        fileInput.value = '';
        resetSlipUI();
        return;
      }

      // Check 5 MB file size limit
      if (file.size > 5 * 1024 * 1024) {
        showSlipError('File size exceeds 5 MB. Please upload a smaller document.');
        fileInput.value = '';
        resetSlipUI();
        return;
      }

      // File is valid
      clearSlipError();
      if (promptEl) promptEl.style.display = 'none';
      if (previewEl) previewEl.style.display = 'flex';
      if (fileNameEl) fileNameEl.textContent = file.name;
      if (fileSizeEl) fileSizeEl.textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
      if (fileIconEl) fileIconEl.textContent = rawExt === '.pdf' ? '📄' : '🖼️';
    });

    if (btnRemove) {
      btnRemove.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.value = '';
        resetSlipUI();
        clearSlipError();
      });
    }
  }

  // Submit Emergency Request Form
  const form = document.getElementById('post-request-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('btn-submit-request');
      submitBtn.disabled = true;
      submitBtn.innerText = 'Broadcasting Request...';

      // 1. Mandatory Document Upload Validation
      if (!fileInput || !fileInput.files || !fileInput.files[0]) {
        const errMsg = "A hospital requisition slip or doctor's prescription is required to submit a blood request.";
        showSlipError(errMsg);
        showToast(errMsg, 'error');
        submitBtn.disabled = false;
        submitBtn.innerText = '🚨 Broadcast Emergency Request';
        const groupEl = document.getElementById('req-file-slip-group');
        if (groupEl) groupEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const file = fileInput.files[0];
      if (file.size > 5 * 1024 * 1024) {
        showSlipError('The selected file exceeds the 5 MB limit. Please select a smaller document.');
        showToast('File size exceeds 5 MB limit.', 'warning');
        submitBtn.disabled = false;
        submitBtn.innerText = '🚨 Broadcast Emergency Request';
        return;
      }

      const patientName = document.getElementById('req-patient-name').value.trim();
      const bloodGroup = document.getElementById('req-blood-group').value;
      const unitsNeeded = document.getElementById('req-units-needed').value;
      const hospitalName = document.getElementById('req-hospital-name').value.trim();
      const doctorName = document.getElementById('req-doctor-name').value.trim();
      const wardBed = document.getElementById('req-ward-bed').value.trim();
      const city = document.getElementById('req-city').value.trim();
      const pincode = document.getElementById('req-pincode').value.trim();
      const contactPhone = document.getElementById('req-contact-phone').value.trim();
      const urgency = document.getElementById('req-urgency').value || 'Urgent';
      const neededBy = document.getElementById('req-needed-by').value;
      const note = document.getElementById('req-note')?.value.trim() || '';

      if (!bloodGroup) {
        showToast('Please select the patient blood group.', 'warning');
        submitBtn.disabled = false;
        submitBtn.innerText = '🚨 Broadcast Emergency Request';
        return;
      }

      // Validate Contact Phone (Indian mobile)
      let phone10 = contactPhone.replace(/[\s\-.()]/g, '');
      if (phone10.startsWith('+91')) phone10 = phone10.slice(3);
      else if (phone10.startsWith('91') && phone10.length === 12) phone10 = phone10.slice(2);
      else if (phone10.startsWith('0') && phone10.length === 11) phone10 = phone10.slice(1);

      if (!/^[6-9]\d{9}$/.test(phone10)) {
        showToast('Please enter a valid 10-digit Indian contact mobile number (e.g. 9876543210).', 'warning');
        document.getElementById('req-contact-phone').focus();
        submitBtn.disabled = false;
        submitBtn.innerText = '🚨 Broadcast Emergency Request';
        return;
      }

      const formData = new FormData();
      formData.append('patient_name', patientName);
      formData.append('blood_group', bloodGroup);
      formData.append('units_needed', unitsNeeded);
      formData.append('hospital_name', hospitalName);
      formData.append('doctor_name', doctorName);
      formData.append('ward_bed', wardBed);
      formData.append('city', city);
      formData.append('area_pincode', pincode);
      formData.append('latitude', document.getElementById('req-lat').value || '');
      formData.append('longitude', document.getElementById('req-lng').value || '');
      formData.append('contact_phone', phone10);
      formData.append('urgency', urgency);
      formData.append('needed_by', neededBy);
      formData.append('note', note);
      formData.append('requisition_slip', file);

      try {
        const token = API.getToken();
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/requests', {
          method: 'POST',
          headers,
          body: formData
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || 'Failed to submit request');
        }

        showToast('Emergency request broadcasted successfully!', 'success');
        closeModal('post-request-modal');
        form.reset();
        resetSlipUI();
        clearSlipError();

        // Show Matching Confirmation Modal
        showMatchingSuccessModal(data);
      } catch (err) {
        showToast(err.message || 'Failed to create emergency request.', 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = '🚨 Broadcast Emergency Request';
      }
    });
  }
}

function showMatchingSuccessModal(data) {
  const modal = document.getElementById('match-results-modal');
  if (!modal) return;

  const countEl = document.getElementById('match-count-text');
  const detailsEl = document.getElementById('match-details-list');

  if (countEl) {
    countEl.innerHTML = `<strong>${data.matchedDonorsCount} eligible donors</strong> have been immediately matched and alerted in <strong>${data.request.city}</strong>!`;
  }

  if (detailsEl) {
    if (data.matchedDonors && data.matchedDonors.length > 0) {
      detailsEl.innerHTML = data.matchedDonors.map(d => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; margin-bottom:8px;">
          <div>
            <strong style="color:#0f172a;">${d.name}</strong> 
            <span style="display:inline-block; margin-left:6px; background:var(--primary-red); color:#fff; padding:2px 8px; border-radius:4px; font-size:0.75rem; font-weight:700;">${d.blood_group}</span>
            <div style="font-size:0.8rem; color:var(--text-muted);">${d.city} (${d.area_pincode || 'Nearby'})</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:0.85rem; font-weight:700; color:var(--success);">${d.distanceKm != null ? d.distanceKm + ' km away' : 'Same City'}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">Alert Dispatched</div>
          </div>
        </div>
      `).join('');
    } else {
      detailsEl.innerHTML = `
        <div style="padding:16px; background:#fef3c7; border:1px solid #fde68a; border-radius:8px; color:#92400e; font-size:0.9rem;">
          No donors directly registered in this radius yet. The request is now listed on the <strong>Public Emergency Board</strong> and hospital blood banks in the area can assist.
        </div>
      `;
    }
  }

  openModal('match-results-modal');
}
