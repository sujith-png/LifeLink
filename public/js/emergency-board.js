// LifeLink Public Emergency Blood Board
(function () {
  const state = {
    filters: {
      blood_group: '',
      city: '',
      urgency: '',
      verification_status: ''
    },
    activeReportRequestId: null
  };

  function getBadgeHtml(verificationStatus) {
    switch (verificationStatus) {
      case 'Hospital Confirmed':
        return '<span class="v-badge v-badge-hospital" title="Cross-checked by hospital administrators with ICU/Ward switchboard">🏥 Hospital Confirmed</span>';
      case 'Document Verified':
        return '<span class="v-badge v-badge-doc" title="Hospital requisition slip verified by LifeLink admin">📄 Document Verified</span>';
      case 'Phone Verified':
        return '<span class="v-badge v-badge-phone" title="Contact phone provided with emergency request">📱 Phone Verified</span>';
      default:
        return '<span class="v-badge v-badge-unverified">⚠️ Unverified</span>';
    }
  }

  function getUrgencyBadge(urgency) {
    if (urgency === 'Critical') {
      return '<span class="urgency-badge urgency-critical"><span class="pulse-dot"></span>🚨 CRITICAL</span>';
    } else if (urgency === 'Urgent') {
      return '<span class="urgency-badge urgency-urgent">⚡ URGENT</span>';
    }
    return '<span class="urgency-badge urgency-normal">NORMAL</span>';
  }

  function formatTimeRemaining(neededByIso) {
    const diff = new Date(neededByIso).getTime() - Date.now();
    if (diff <= 0) return '<span style="color:var(--danger); font-weight:700;">Expired</span>';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `Needed in ${days}d ${hours % 24}h`;
    }
    return `Needed in ${hours}h ${mins}m`;
  }

  async function loadEmergencyBoard() {
    const listEl = document.getElementById('board-requests-list');
    const countEl = document.getElementById('board-count');
    const loadingEl = document.getElementById('board-loading');

    if (!listEl) return;
    if (loadingEl) loadingEl.style.display = 'block';

    try {
      const queryParams = new URLSearchParams();
      if (state.filters.blood_group) queryParams.set('blood_group', state.filters.blood_group);
      if (state.filters.city) queryParams.set('city', state.filters.city);
      if (state.filters.urgency) queryParams.set('urgency', state.filters.urgency);
      if (state.filters.verification_status) queryParams.set('verification_status', state.filters.verification_status);

      const res = await API.request(`/api/requests?${queryParams.toString()}`);

      if (loadingEl) loadingEl.style.display = 'none';

      if (!res.success || !res.requests) {
        listEl.innerHTML = '<p class="text-muted" style="text-align:center; padding:30px;">Failed to load emergency requests.</p>';
        return;
      }

      if (countEl) countEl.textContent = `${res.count} active emergency request(s)`;

      // Populate city filter options if empty
      const citySelect = document.getElementById('board-filter-city');
      if (citySelect && citySelect.options.length <= 1 && res.activeCities) {
        res.activeCities.forEach(city => {
          const opt = document.createElement('option');
          opt.value = city;
          opt.textContent = city;
          citySelect.appendChild(opt);
        });
      }

      if (res.requests.length === 0) {
        listEl.innerHTML = `
          <div class="card" style="text-align:center; padding: 48px 20px;">
            <div style="font-size:3rem; margin-bottom:12px;">✅</div>
            <h3 style="font-size:1.3rem; font-weight:700; color:#334155;">No Active Emergencies</h3>
            <p style="color:var(--text-muted); margin-top:6px; max-width:440px; margin-left:auto; margin-right:auto;">
              No open requests currently match your selected filters. Check back soon or broaden your search criteria.
            </p>
            <button class="btn btn-secondary" style="margin-top:16px;" onclick="window.LifeLink.resetBoardFilters()">Reset Filters</button>
          </div>
        `;
        return;
      }

      const user = API.getUser();

      listEl.innerHTML = res.requests.map(r => {
        const trustBadge = r.trust_score?.badge
          ? `<span class="trust-badge" title="Requester Trust Score: ${r.trust_score.score}">
              ${r.trust_score.badgeIcon} ${r.trust_score.badge}
             </span>`
          : '';

        const phoneDisplay = r.can_view_contact
          ? `<a href="tel:${r.contact_phone}" style="color:var(--primary-dark); font-weight:700; text-decoration:none;">📞 ${r.contact_phone}</a>`
          : `<span style="color:var(--text-muted); font-family:monospace;">🔒 ${r.contact_phone}</span> <span style="font-size:0.75rem; color:var(--primary-red);">(Accept to reveal)</span>`;

        return `
          <div class="card request-board-card ${r.urgency === 'Critical' ? 'card-critical-border' : ''}">
            <div class="board-card-header">
              <div style="display:flex; align-items:center; gap:12px;">
                <div class="blood-chip-circle">${r.blood_group}</div>
                <div>
                  <h3 class="board-patient-name">${r.patient_name}</h3>
                  <div style="font-size:0.85rem; color:var(--text-muted); display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:2px;">
                    <span>📍 <strong>${r.hospital_name}</strong>, ${r.city}</span>
                    <span>•</span>
                    <span>Units: <strong>${r.units_needed}</strong></span>
                  </div>
                </div>
              </div>
              <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
                ${getUrgencyBadge(r.urgency)}
                <span class="board-time-pill">⏰ ${formatTimeRemaining(r.needed_by)}</span>
              </div>
            </div>

            <div class="board-card-badges" style="margin: 14px 0; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
              ${getBadgeHtml(r.verification_status)}
              ${trustBadge}
              <span class="badge-response-count">🤝 ${r.accepted_donors_count || 0} Donor(s) Accepted</span>
            </div>

            ${r.note ? `<p class="board-request-note">“${r.note}”</p>` : ''}

            <div class="board-card-footer">
              <div class="board-contact-info">
                <span style="font-size:0.85rem; color:var(--text-muted);">Requester Phone:</span>
                ${phoneDisplay}
              </div>
              <div class="board-card-actions">
                <button class="btn btn-outline-red btn-sm" onclick="window.LifeLink.openReportModal(${r.id}, '${r.patient_name.replace(/'/g, "\\'")}')">
                  🚩 Report
                </button>
                <button class="btn btn-primary btn-sm" onclick="window.LifeLink.openRequestDetails(${r.id})">
                  View & Respond ➔
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      console.error('[loadEmergencyBoard] Error:', err);
      listEl.innerHTML = '<p class="text-muted" style="text-align:center; padding:30px;">Error connecting to emergency board.</p>';
    }
  }

  function resetBoardFilters() {
    state.filters = { blood_group: '', city: '', urgency: '', verification_status: '' };
    const bgSelect = document.getElementById('board-filter-blood');
    const citySelect = document.getElementById('board-filter-city');
    const urgSelect = document.getElementById('board-filter-urgency');
    const verSelect = document.getElementById('board-filter-verification');

    if (bgSelect) bgSelect.value = '';
    if (citySelect) citySelect.value = '';
    if (urgSelect) urgSelect.value = '';
    if (verSelect) verSelect.value = '';

    loadEmergencyBoard();
  }

  function openReportModal(requestId, patientName) {
    state.activeReportRequestId = requestId;
    const reqIdEl = document.getElementById('report-request-id-display');
    if (reqIdEl) reqIdEl.textContent = `#${requestId} (Patient: ${patientName})`;
    openModal('report-request-modal');
  }

  async function submitReport(e) {
    e.preventDefault();
    if (!state.activeReportRequestId) return;

    const reasonEl = document.getElementById('report-reason');
    const detailsEl = document.getElementById('report-details');
    const phoneEl = document.getElementById('report-phone');

    const reason = reasonEl ? reasonEl.value : '';
    const details = detailsEl ? detailsEl.value : '';
    const phone = phoneEl ? phoneEl.value : '';

    if (!reason) {
      showToast('Please select a reason for reporting this post.', 'warning');
      return;
    }

    try {
      const res = await API.request(`/api/requests/${state.activeReportRequestId}/report`, {
        method: 'POST',
        body: JSON.stringify({
          reason,
          details,
          reporter_phone: phone || null
        })
      });

      showToast(res.message || 'Report submitted for administrator audit.', res.isAutoHidden ? 'warning' : 'success');
      closeModal('report-request-modal');

      // Reset form
      if (detailsEl) detailsEl.value = '';
      if (phoneEl) phoneEl.value = '';

      // Reload board to reflect possible auto-hide
      loadEmergencyBoard();
    } catch (err) {
      showToast(err.message || 'Failed to submit report.', 'error');
    }
  }

  function init() {
    // Filter change listeners
    document.getElementById('board-filter-blood')?.addEventListener('change', (e) => {
      state.filters.blood_group = e.target.value;
      loadEmergencyBoard();
    });

    document.getElementById('board-filter-city')?.addEventListener('change', (e) => {
      state.filters.city = e.target.value;
      loadEmergencyBoard();
    });

    document.getElementById('board-filter-urgency')?.addEventListener('change', (e) => {
      state.filters.urgency = e.target.value;
      loadEmergencyBoard();
    });

    document.getElementById('board-filter-verification')?.addEventListener('change', (e) => {
      state.filters.verification_status = e.target.value;
      loadEmergencyBoard();
    });

    // Report form submit
    document.getElementById('report-form')?.addEventListener('submit', submitReport);

    // View change listener
    window.addEventListener('lifelink:view-changed', (e) => {
      if (e.detail.view === 'emergency-board') {
        loadEmergencyBoard();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  window.LifeLink = window.LifeLink || {};
  window.LifeLink.loadEmergencyBoard = loadEmergencyBoard;
  window.LifeLink.resetBoardFilters = resetBoardFilters;
  window.LifeLink.openReportModal = openReportModal;
})();
