// LifeLink Blood Banks & Hospitals Directory
(function () {
  const state = {
    city: '',
    searchQuery: ''
  };

  async function loadBloodBanks() {
    const listEl = document.getElementById('banks-list');
    const countEl = document.getElementById('banks-count');
    const loadingEl = document.getElementById('banks-loading');

    if (!listEl) return;
    if (loadingEl) loadingEl.style.display = 'block';

    try {
      const queryParams = new URLSearchParams();
      if (state.city) queryParams.set('city', state.city);
      if (state.searchQuery) queryParams.set('q', state.searchQuery);

      const res = await API.request(`/api/blood-banks?${queryParams.toString()}`);

      if (loadingEl) loadingEl.style.display = 'none';

      if (!res.success || !res.bloodBanks) {
        listEl.innerHTML = '<p class="text-muted" style="text-align:center; padding:30px;">Failed to load blood banks directory.</p>';
        return;
      }

      if (countEl) countEl.textContent = `${res.count} verified facilities found`;

      // Populate city dropdown if empty
      const citySelect = document.getElementById('banks-filter-city');
      if (citySelect && citySelect.options.length <= 1 && res.cities) {
        res.cities.forEach(city => {
          const opt = document.createElement('option');
          opt.value = city;
          opt.textContent = city;
          citySelect.appendChild(opt);
        });
      }

      if (res.bloodBanks.length === 0) {
        listEl.innerHTML = `
          <div class="card" style="text-align:center; padding: 40px 20px; grid-column: 1 / -1;">
            <p style="font-size: 2rem; margin-bottom: 8px;">🏥</p>
            <h3 style="font-size: 1.15rem; font-weight:700; color:#334155;">No Blood Banks Found</h3>
            <p style="color:var(--text-muted); font-size:0.9rem; margin-top:4px;">No facilities match "${state.searchQuery}". Try a different city or keyword.</p>
          </div>
        `;
        return;
      }

      listEl.innerHTML = res.bloodBanks.map(b => `
        <div class="card bank-card">
          <div class="bank-card-header">
            <div>
              <span class="bank-partner-badge">🏥 Verified Hospital Blood Bank</span>
              <h3 class="bank-title">${b.name}</h3>
              <p class="bank-city">📍 ${b.city}</p>
            </div>
            <div class="bank-hours-pill">🕒 ${b.operating_hours || '24/7'}</div>
          </div>

          <p class="bank-address">${b.address}</p>

          <div class="bank-card-footer">
            <div class="bank-phone-block">
              <span style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase; font-weight:700; letter-spacing:0.5px;">Official Landline Switchboard</span>
              <a href="tel:${b.official_hospital_phone || b.phone}" class="bank-phone-link">
                📞 ${b.official_hospital_phone || b.phone}
              </a>
            </div>
            <button class="btn btn-secondary btn-sm" onclick="window.LifeLink.searchEmergenciesInCity('${b.city}')" title="Find emergencies needing blood in ${b.city}">
              View ${b.city} Requests ➔
            </button>
          </div>
        </div>
      `).join('');
    } catch (err) {
      console.error('[loadBloodBanks] Error:', err);
      listEl.innerHTML = '<p class="text-muted" style="text-align:center; padding:30px;">Error loading blood bank directory.</p>';
    }
  }

  function searchEmergenciesInCity(city) {
    showView('emergency-board');
    const citySelect = document.getElementById('board-filter-city');
    if (citySelect) {
      citySelect.value = city;
      citySelect.dispatchEvent(new Event('change'));
    }
  }

  function init() {
    // City filter listener
    document.getElementById('banks-filter-city')?.addEventListener('change', (e) => {
      state.city = e.target.value;
      loadBloodBanks();
    });

    // Search query listener with debounce
    let debounceTimer;
    document.getElementById('banks-search-input')?.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.searchQuery = e.target.value;
        loadBloodBanks();
      }, 300);
    });

    // View change listener
    window.addEventListener('lifelink:view-changed', (e) => {
      if (e.detail.view === 'blood-banks') {
        loadBloodBanks();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  window.LifeLink = window.LifeLink || {};
  window.LifeLink.loadBloodBanks = loadBloodBanks;
  window.LifeLink.searchEmergenciesInCity = searchEmergenciesInCity;
})();
