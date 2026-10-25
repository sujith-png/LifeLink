// LifeLink Administrative Control Center
(function () {
  let activeTab = 'queue';

  function isAdmin() {
    const user = API.getUser();
    return user && user.role === 'admin';
  }

  async function loadAdminDashboard() {
    const authGateEl = document.getElementById('admin-auth-gate');
    const mainPanelEl = document.getElementById('admin-main-panel');

    if (!isAdmin()) {
      if (authGateEl) authGateEl.style.display = 'block';
      if (mainPanelEl) mainPanelEl.style.display = 'none';
      return;
    }

    if (authGateEl) authGateEl.style.display = 'none';
    if (mainPanelEl) mainPanelEl.style.display = 'block';

    // 1. Load Stats
    await loadStats();

    // 2. Load Active Tab Content
    switchTab(activeTab);
  }

  async function loadStats() {
    try {
      const res = await API.request('/api/admin/stats');
      if (res.success && res.stats) {
        const s = res.stats;
        document.getElementById('admin-stat-donors').textContent = s.totalDonors;
        document.getElementById('admin-stat-active').textContent = s.activeRequests;
        document.getElementById('admin-stat-fulfilled').textContent = s.fulfilledRequests;
        document.getElementById('admin-stat-flagged').textContent = s.flaggedOrHidden;
        document.getElementById('admin-stat-blocked').textContent = s.blockedPhones;
        document.getElementById('admin-stat-banks').textContent = s.bloodBanksCount;
      }
    } catch (err) {
      console.error('[loadStats] Error:', err);
    }
  }

  function switchTab(tabName) {
    activeTab = tabName;

    // Toggle tab active classes
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Toggle tab panels
    document.querySelectorAll('.admin-tab-content').forEach(panel => {
      panel.style.display = panel.id === `admin-tab-${tabName}` ? 'block' : 'none';
    });

    if (tabName === 'queue') loadVerificationQueue();
    else if (tabName === 'reports') loadReportsQueue();
    else if (tabName === 'blocklist') loadBlocklist();
    else if (tabName === 'audit') loadAuditLogs();
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  let currentSlipZoom = 1.0;
  let activeModalRequestId = null;
  let activeModalPatientName = '';

  function updateSlipZoom(zoomLevel) {
    currentSlipZoom = Math.min(3.0, Math.max(0.5, zoomLevel));
    const container = document.getElementById('admin-slip-container');
    const zoomLevelEl = document.getElementById('slip-zoom-level');
    if (container) {
      container.style.transform = `scale(${currentSlipZoom})`;
    }
    if (zoomLevelEl) {
      zoomLevelEl.textContent = `${Math.round(currentSlipZoom * 100)}%`;
    }
  }

  // --- TAB 1: VERIFICATION QUEUE ---
  async function loadVerificationQueue() {
    const container = document.getElementById('admin-queue-list');
    if (!container) return;
    container.innerHTML = '<p class="text-muted" style="padding:20px; text-align:center;">Loading verification queue...</p>';

    try {
      const res = await API.request('/api/admin/verification-queue');
      if (!res.success || !res.queue) {
        container.innerHTML = '<p class="text-muted" style="padding:20px;">Failed to load queue.</p>';
        return;
      }

      if (res.queue.length === 0) {
        container.innerHTML = '<p class="text-muted" style="padding:30px; text-align:center;">✅ No requests currently awaiting verification.</p>';
        return;
      }

      container.innerHTML = res.queue.map(r => {
        const officialPhone = r.official_hospital_contact?.official_hospital_phone;
        const officialHospitalName = r.official_hospital_contact?.name || 'No direct directory match';

        // Document status badge
        const docStatus = r.document_status || (r.has_slip ? 'PENDING' : 'MISSING');
        let docBadgeHtml = '';
        if (docStatus === 'VERIFIED') {
          docBadgeHtml = '<span class="v-badge" style="background:#dcfce7; color:#15803d; border:1px solid #86efac; font-weight:700;">✅ Doc: VERIFIED</span>';
        } else if (docStatus === 'REJECTED') {
          docBadgeHtml = '<span class="v-badge" style="background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; font-weight:700;">❌ Doc: REJECTED</span>';
        } else if (docStatus === 'PENDING') {
          docBadgeHtml = '<span class="v-badge" style="background:#fef3c7; color:#b45309; border:1px solid #fde68a; font-weight:700;">⏳ Doc: PENDING</span>';
        } else {
          docBadgeHtml = '<span class="v-badge" style="background:#f1f5f9; color:#64748b; border:1px solid #cbd5e1; font-weight:700;">⚠️ Doc: MISSING</span>';
        }

        const safePatientName = escapeHtml(r.patient_name);

        return `
          <div class="card admin-queue-item ${r.is_hidden ? 'item-hidden' : ''}">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;">
              <div>
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                  <span class="blood-chip-circle" style="width:36px; height:36px; font-size:1rem;">${r.blood_group}</span>
                  <h4 style="font-size:1.15rem; font-weight:700;">Request #${r.id}: ${safePatientName}</h4>
                  <span class="v-badge v-badge-phone">${r.verification_status}</span>
                  ${docBadgeHtml}
                  ${r.is_hidden ? '<span class="v-badge v-badge-unverified" style="background:#fee2e2; color:#b91c1c;">🚫 Auto-Hidden</span>' : ''}
                  ${r.is_suspicious ? '<span class="v-badge v-badge-unverified">⚠️ Suspicious</span>' : ''}
                </div>
                <div style="font-size:0.85rem; color:var(--text-muted); margin-top:6px;">
                  <span>🏥 <strong>${escapeHtml(r.hospital_name)}</strong> (${escapeHtml(r.city)})</span> • 
                  <span>Units: <strong>${r.units_needed}</strong></span> • 
                  <span>Urgency: <strong>${r.urgency}</strong></span> • 
                  <span>Doctor: <strong>${escapeHtml(r.doctor_name || 'Not provided')}</strong></span> • 
                  <span>Ward: <strong>${escapeHtml(r.ward_bed || 'Not provided')}</strong></span>
                </div>
              </div>
              <div style="text-align:right;">
                <span style="font-size:0.8rem; color:var(--text-muted);">Posted: ${new Date(r.created_at).toLocaleString()}</span>
              </div>
            </div>

            <!-- Hospital Cross-Match Phone Box -->
            <div class="admin-hospital-call-box">
              <div>
                <span style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:#0f766e; letter-spacing:0.5px;">
                  Official Hospital Directory Match (Do NOT call requester number for verification):
                </span>
                <p style="font-weight:600; font-size:0.95rem; margin-top:2px;">
                  ${escapeHtml(officialHospitalName)}
                </p>
              </div>
              <div>
                ${officialPhone
                  ? `<a href="tel:${officialPhone}" class="btn btn-secondary btn-sm" style="font-weight:700;">
                       📞 Call Switchboard: ${officialPhone}
                     </a>`
                  : `<span style="font-size:0.85rem; color:var(--text-muted);">No official telephone on file</span>`
                }
              </div>
            </div>

            ${r.document_rejection_reason ? `
              <div style="margin-top:10px; padding:8px 12px; background:#fef2f2; border:1px solid #fecaca; border-radius:6px; color:#b91c1c; font-size:0.85rem;">
                <strong>Document Rejection Reason:</strong> ${escapeHtml(r.document_rejection_reason)}
              </div>
            ` : ''}

            <!-- Actions Row -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px; padding-top:12px; border-top:1px solid var(--border-color); flex-wrap:wrap; gap:10px;">
              <div>
                ${r.has_slip
                  ? `<button class="btn btn-secondary btn-sm" onclick="window.LifeLink.viewAdminSlip(${r.id}, '${safePatientName}', '${docStatus}')">
                       🔍 View Document
                     </button>`
                  : `<span style="font-size:0.85rem; color:#dc2626; font-weight:600; background:#fee2e2; padding:3px 8px; border-radius:4px;">
                       ⚠️ Document Missing
                     </span>`
                }
              </div>
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                ${r.has_slip
                  ? `
                    ${docStatus !== 'VERIFIED'
                      ? `<button class="btn btn-success btn-sm" onclick="window.LifeLink.confirmApproveDocument(${r.id}, '${safePatientName}')">
                           ✅ Approve Document
                         </button>`
                      : ''
                    }
                    ${docStatus !== 'REJECTED'
                      ? `<button class="btn btn-outline-red btn-sm" onclick="window.LifeLink.confirmRejectDocument(${r.id}, '${safePatientName}')">
                           ❌ Reject Document
                         </button>`
                      : ''
                    }
                  `
                  : `
                    <button class="btn btn-secondary btn-sm" disabled style="opacity:0.55; cursor:not-allowed;" title="Cannot approve without a document">
                      Approve Document (Disabled)
                    </button>
                    <button class="btn btn-outline-red btn-sm" onclick="window.LifeLink.confirmRejectDocument(${r.id}, '${safePatientName}')">
                      ❌ Reject
                    </button>
                  `
                }
                <button class="btn btn-secondary btn-sm" onclick="window.LifeLink.updateVerification(${r.id}, 'Hospital Confirmed', 'phone_call_hospital')">
                  🏥 Confirm Hospital (ICU/Ward)
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      console.error('[loadVerificationQueue] Error:', err);
    }
  }

  async function updateVerification(requestId, status, method, notes = '') {
    try {
      const res = await API.request(`/api/admin/requests/${requestId}/verify`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          verification_method: method,
          notes: notes || `Admin verified via ${method}`
        })
      });

      showToast(res.message || `Request updated to ${status}`, 'success');
      loadAdminDashboard();
    } catch (err) {
      showToast(err.message || 'Verification update failed', 'error');
    }
  }

  async function confirmApproveDocument(requestId, patientName) {
    const confirmed = confirm(
      `CONFIRM APPROVAL:\n\nAre you sure you want to approve the medical requisition slip for Request #${requestId} (${patientName || 'Patient'})?\n\nThis will mark the document status as VERIFIED.`
    );
    if (!confirmed) return;

    try {
      const res = await API.request(`/api/admin/requests/${requestId}/verify-document`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'approve' })
      });

      showToast(res.message || 'Document approved successfully!', 'success');
      closeModal('admin-slip-modal');
      loadAdminDashboard();
    } catch (err) {
      showToast(err.message || 'Failed to approve document', 'error');
    }
  }

  async function confirmRejectDocument(requestId, patientName) {
    const reason = prompt(
      `REJECT DOCUMENT:\n\nPlease enter the mandatory reason for rejecting this medical document for Request #${requestId} (${patientName || 'Patient'}):`
    );
    if (reason === null) return; // User cancelled prompt

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      showToast('A rejection reason is required to reject a document.', 'warning');
      return;
    }

    const confirmed = confirm(
      `CONFIRM REJECTION:\n\nAre you sure you want to REJECT the document for Request #${requestId} with reason:\n"${trimmedReason}"?\n\nThis will cancel the blood request and notify the requester.`
    );
    if (!confirmed) return;

    try {
      const res = await API.request(`/api/admin/requests/${requestId}/verify-document`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'reject', reason: trimmedReason })
      });

      showToast(res.message || 'Document rejected and request cancelled.', 'success');
      closeModal('admin-slip-modal');
      loadAdminDashboard();
    } catch (err) {
      showToast(err.message || 'Failed to reject document', 'error');
    }
  }

  function promptRejectRequest(requestId) {
    confirmRejectDocument(requestId, '');
  }

  function viewAdminSlip(requestId, patientName = '', docStatus = 'PENDING') {
    activeModalRequestId = requestId;
    activeModalPatientName = patientName;

    const token = API.getToken();
    const slipModal = document.getElementById('admin-slip-modal');
    const slipImg = document.getElementById('admin-slip-image');
    const slipFrame = document.getElementById('admin-slip-frame');
    const slipLink = document.getElementById('admin-slip-download-link');
    const slipLoading = document.getElementById('admin-slip-loading');
    const titleEl = document.getElementById('admin-slip-modal-title');
    const patientSubEl = document.getElementById('admin-slip-patient-sub');
    const badgeEl = document.getElementById('admin-slip-doc-badge');
    const zoomToolbar = document.getElementById('admin-slip-zoom-toolbar');

    if (!slipModal) return;

    if (titleEl) titleEl.textContent = `Medical Document Inspection — Request #${requestId}`;
    if (patientSubEl) patientSubEl.textContent = `Patient: ${patientName || 'Emergency Patient'} • Confidential Requisition Slip`;
    if (badgeEl) {
      badgeEl.textContent = docStatus;
      badgeEl.style.background = docStatus === 'VERIFIED' ? '#dcfce7' : docStatus === 'REJECTED' ? '#fee2e2' : '#fef3c7';
      badgeEl.style.color = docStatus === 'VERIFIED' ? '#15803d' : docStatus === 'REJECTED' ? '#b91c1c' : '#b45309';
    }

    // Reset Zoom
    updateSlipZoom(1.0);

    // Initial loading state
    if (slipImg) slipImg.style.display = 'none';
    if (slipFrame) slipFrame.style.display = 'none';
    if (slipLoading) slipLoading.style.display = 'block';

    const url = `/api/admin/requests/${requestId}/slip`;

    // Fetch as blob with auth header
    fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
      .then(res => {
        if (!res.ok) throw new Error('Slip not accessible or not found.');
        return res.blob();
      })
      .then(blob => {
        if (slipLoading) slipLoading.style.display = 'none';
        const objectUrl = URL.createObjectURL(blob);

        if (blob.type.includes('image')) {
          if (slipImg) {
            slipImg.src = objectUrl;
            slipImg.style.display = 'block';
          }
          if (slipFrame) slipFrame.style.display = 'none';
          if (zoomToolbar) zoomToolbar.style.display = 'flex';
        } else {
          // PDF document
          if (slipFrame) {
            slipFrame.src = objectUrl;
            slipFrame.style.display = 'block';
          }
          if (slipImg) slipImg.style.display = 'none';
          if (zoomToolbar) zoomToolbar.style.display = 'none';
        }

        if (slipLink) {
          slipLink.href = objectUrl;
          slipLink.download = `medical_slip_req_${requestId}`;
        }
      })
      .catch(err => {
        if (slipLoading) slipLoading.textContent = `❌ ${err.message || 'Failed to stream requisition slip.'}`;
        showToast(err.message || 'Failed to stream requisition slip.', 'error');
      });

    openModal('admin-slip-modal');
  }

  // --- TAB 2: REPORTS & MODERATION ---
  async function loadReportsQueue() {
    const container = document.getElementById('admin-reports-list');
    if (!container) return;
    container.innerHTML = '<p class="text-muted" style="padding:20px; text-align:center;">Loading reports...</p>';

    try {
      const res = await API.request('/api/admin/reports');
      if (!res.success || !res.reports) {
        container.innerHTML = '<p class="text-muted" style="padding:20px;">Failed to load reports.</p>';
        return;
      }

      if (res.reports.length === 0) {
        container.innerHTML = '<p class="text-muted" style="padding:30px; text-align:center;">✅ No reports have been submitted.</p>';
        return;
      }

      container.innerHTML = res.reports.map(rep => `
        <div class="card admin-queue-item" style="margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px;">
            <div>
              <span class="v-badge ${rep.report_status === 'pending' ? 'v-badge-unverified' : 'v-badge-phone'}">
                Report #${rep.report_id} (${rep.report_status.toUpperCase()})
              </span>
              <h4 style="font-size:1.05rem; font-weight:700; margin-top:4px;">
                Request #${rep.request_id}: ${rep.patient_name} (${rep.hospital_name}, ${rep.city})
              </h4>
              <p style="font-size:0.9rem; color:var(--primary-dark); font-weight:600; margin-top:4px;">
                Reason: ${rep.reason}
              </p>
              ${rep.details ? `<p style="font-size:0.85rem; color:var(--text-muted); margin-top:2px;">Details: “${rep.details}”</p>` : ''}
              <div style="font-size:0.8rem; color:var(--text-light); margin-top:6px;">
                Reporter IP: <code>${rep.reporter_ip || 'N/A'}</code> • 
                Reporter Phone: <code>${rep.reporter_phone || 'Anonymous'}</code> • 
                Reported: ${new Date(rep.reported_at).toLocaleString()}
              </div>
            </div>

            <div style="display:flex; flex-direction:column; gap:6px;">
              <button class="btn btn-secondary btn-sm" onclick="window.LifeLink.restoreRequest(${rep.request_id})">
                🛡️ Restore & Dismiss False Reports
              </button>
              <button class="btn btn-outline-red btn-sm" onclick="window.LifeLink.upholdReports(${rep.request_id})">
                🚫 Uphold & Block Coordinator
              </button>
            </div>
          </div>
        </div>
      `).join('');
    } catch (err) {
      console.error('[loadReportsQueue] Error:', err);
    }
  }

  async function restoreRequest(requestId) {
    const notes = prompt('Enter notes for restoring this request (dismissing reports):', 'False flag - verified with hospital');
    if (notes === null) return;

    try {
      const res = await API.request(`/api/admin/requests/${requestId}/restore`, {
        method: 'PATCH',
        body: JSON.stringify({ notes })
      });
      showToast(res.message || 'Request restored and false reports dismissed.', 'success');
      loadAdminDashboard();
    } catch (err) {
      showToast(err.message || 'Failed to restore request', 'error');
    }
  }

  async function upholdReports(requestId) {
    const shouldBlock = confirm('Reports upheld! Would you also like to permanently block this coordinator phone number from LifeLink?');
    const notes = prompt('Enter audit notes for upholding reports:', 'Confirmed spam / fraud');
    if (notes === null) return;

    try {
      const res = await API.request(`/api/admin/requests/${requestId}/uphold-reports`, {
        method: 'PATCH',
        body: JSON.stringify({
          notes,
          shouldBlockPhone: shouldBlock
        })
      });
      showToast(res.message || 'Request rejected and reports upheld.', 'success');
      loadAdminDashboard();
    } catch (err) {
      showToast(err.message || 'Failed to uphold reports', 'error');
    }
  }

  // --- TAB 3: PHONE BLOCKLIST ---
  async function loadBlocklist() {
    const tableBody = document.getElementById('admin-blocklist-table-body');
    if (!tableBody) return;
    tableBody.innerHTML = '<tr><td colspan="5" class="text-muted" style="text-align:center; padding:16px;">Loading blocklist...</td></tr>';

    try {
      const res = await API.request('/api/admin/blocklist');
      if (!res.success || !res.blocklist) {
        tableBody.innerHTML = '<tr><td colspan="5" class="text-muted" style="text-align:center; padding:16px;">Failed to load blocklist.</td></tr>';
        return;
      }

      if (res.blocklist.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" class="text-muted" style="text-align:center; padding:24px;">No phone numbers currently on blocklist.</td></tr>';
        return;
      }

      tableBody.innerHTML = res.blocklist.map(b => `
        <tr>
          <td><strong>${b.phone}</strong></td>
          <td>${b.reason}</td>
          <td>${b.blocked_by_email || 'System / Auto'}</td>
          <td>
            <span class="v-badge ${b.is_active ? 'v-badge-unverified' : 'v-badge-phone'}">
              ${b.is_active ? 'Active' : 'Unblocked'}
            </span>
          </td>
          <td>
            ${b.is_active
              ? `<button class="btn btn-secondary btn-sm" onclick="window.LifeLink.unblockPhone('${b.phone}')">Unblock</button>`
              : '<span style="color:var(--text-light); font-size:0.8rem;">Inactive</span>'
            }
          </td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('[loadBlocklist] Error:', err);
    }
  }

  async function addPhoneToBlocklist(e) {
    e.preventDefault();
    const phoneInput = document.getElementById('blocklist-add-phone');
    const reasonInput = document.getElementById('blocklist-add-reason');

    const phone = phoneInput ? phoneInput.value.trim() : '';
    const reason = reasonInput ? reasonInput.value.trim() : '';

    if (!phone || !reason) {
      showToast('Please provide both phone number and reason.', 'warning');
      return;
    }

    try {
      const res = await API.request('/api/admin/blocklist', {
        method: 'POST',
        body: JSON.stringify({ phone, reason })
      });

      showToast(res.message || 'Phone added to blocklist.', 'success');
      if (phoneInput) phoneInput.value = '';
      if (reasonInput) reasonInput.value = '';
      loadBlocklist();
      loadStats();
    } catch (err) {
      showToast(err.message || 'Failed to add phone to blocklist.', 'error');
    }
  }

  async function unblockPhone(phone) {
    if (!confirm(`Are you sure you want to unblock ${phone}?`)) return;

    try {
      const res = await API.request(`/api/admin/blocklist/${phone}/unblock`, {
        method: 'PATCH'
      });
      showToast(res.message || 'Phone unblocked successfully.', 'success');
      loadBlocklist();
      loadStats();
    } catch (err) {
      showToast(err.message || 'Failed to unblock phone.', 'error');
    }
  }

  // --- TAB 4: AUDIT LOGS ---
  async function loadAuditLogs() {
    const tableBody = document.getElementById('admin-audit-table-body');
    if (!tableBody) return;
    tableBody.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center; padding:16px;">Loading audit logs...</td></tr>';

    try {
      const res = await API.request('/api/admin/verification-logs');
      if (!res.success || !res.logs) {
        tableBody.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center; padding:16px;">Failed to load audit logs.</td></tr>';
        return;
      }

      if (res.logs.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center; padding:24px;">No verification logs recorded yet.</td></tr>';
        return;
      }

      tableBody.innerHTML = res.logs.map(l => `
        <tr>
          <td>#${l.request_id} (${l.patient_name || 'Request'})</td>
          <td>${l.admin_email}</td>
          <td><span style="font-size:0.8rem; color:var(--text-muted);">${l.old_status}</span> ➔ <strong>${l.new_status}</strong></td>
          <td><code>${l.verification_method}</code></td>
          <td style="font-size:0.85rem;">${l.notes || '--'}</td>
          <td style="font-size:0.8rem; color:var(--text-light);">${new Date(l.created_at).toLocaleString()}</td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('[loadAuditLogs] Error:', err);
    }
  }

  function init() {
    // Tab navigation buttons
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Blocklist form submit
    document.getElementById('admin-add-blocklist-form')?.addEventListener('submit', addPhoneToBlocklist);

    // Zoom controls for document inspection viewer
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => updateSlipZoom(currentSlipZoom + 0.25));
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => updateSlipZoom(currentSlipZoom - 0.25));
    document.getElementById('btn-zoom-reset')?.addEventListener('click', () => updateSlipZoom(1.0));

    // Modal Approve / Reject Document buttons
    document.getElementById('btn-modal-approve-doc')?.addEventListener('click', () => {
      if (activeModalRequestId) {
        confirmApproveDocument(activeModalRequestId, activeModalPatientName);
      }
    });
    document.getElementById('btn-modal-reject-doc')?.addEventListener('click', () => {
      if (activeModalRequestId) {
        confirmRejectDocument(activeModalRequestId, activeModalPatientName);
      }
    });

    // View change listener
    window.addEventListener('lifelink:view-changed', (e) => {
      if (e.detail.view === 'admin-dashboard') {
        loadAdminDashboard();
      }
    });

    // Auth change listener
    window.addEventListener('lifelink:auth-changed', () => {
      const user = API.getUser();
      const adminNav = document.getElementById('nav-link-admin');
      if (adminNav) {
        adminNav.style.display = user && user.role === 'admin' ? 'block' : 'none';
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  window.LifeLink = window.LifeLink || {};
  window.LifeLink.loadAdminDashboard = loadAdminDashboard;
  window.LifeLink.updateVerification = updateVerification;
  window.LifeLink.promptRejectRequest = promptRejectRequest;
  window.LifeLink.viewAdminSlip = viewAdminSlip;
  window.LifeLink.confirmApproveDocument = confirmApproveDocument;
  window.LifeLink.confirmRejectDocument = confirmRejectDocument;
  window.LifeLink.restoreRequest = restoreRequest;
  window.LifeLink.upholdReports = upholdReports;
  window.LifeLink.unblockPhone = unblockPhone;
})();
