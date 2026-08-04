// Fleet Wolf Driver Dashboard
// Standard Geotab Add-In entry point. MyGeotab injects `api` and `state`
// into initialize/focus/blur — see:
// https://developers.geotab.com/myGeotab/addIns/developingAddIns

geotab.addin.driverDashboard = function () {
  'use strict';

  let api = null;
  let currentRange = 'day'; // 'day' | 'week'
  let currentDeviceId = null;

  // ---- DOM refs ----
  const el = {
    deviceSelect: () => document.getElementById('deviceSelect'),
    rangeBtns: () => document.querySelectorAll('.rangeBtn'),
    stops: () => document.getElementById('stopsValue'),
    mileage: () => document.getElementById('mileageValue'),
    fuel: () => document.getElementById('fuelValue'),
    hosDrive: () => document.getElementById('hosDriveValue'),
    hosDuty: () => document.getElementById('hosDutyValue'),
    rateInput: () => document.getElementById('rateInput'),
    fuelPriceInput: () => document.getElementById('fuelPriceInput'),
    grossPay: () => document.getElementById('grossPayValue'),
    fuelCost: () => document.getElementById('fuelCostValue'),
    net: () => document.getElementById('netValue')
  };

  // ---- Date range helpers ----
  function getRangeDates(range) {
    const now = new Date();
    const toDate = now.toISOString();
    const from = new Date(now);
    if (range === 'day') {
      from.setHours(0, 0, 0, 0);
    } else {
      from.setDate(from.getDate() - 7);
    }
    return { fromDate: from.toISOString(), toDate };
  }

  // ---- Load the vehicle list into the dropdown ----
  function loadDevices() {
    api.call('Get', { typeName: 'Device', resultsLimit: 500 }, function (devices) {
      const select = el.deviceSelect();
      select.innerHTML = '';
      devices
        .filter(d => d.name && !d.name.startsWith('*'))
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(d => {
          const opt = document.createElement('option');
          opt.value = d.id;
          opt.textContent = d.name;
          select.appendChild(opt);
        });
      if (select.options.length) {
        currentDeviceId = select.options[0].value;
        refreshDashboard();
      }
    }, function (err) {
      console.error('Get Device failed', err);
    });
  }

  // ---- Trips: stops + mileage ----
  function loadTrips(deviceId, fromDate, toDate) {
    api.call('Get', {
      typeName: 'Trip',
      search: { deviceSearch: { id: deviceId }, fromDate, toDate }
    }, function (trips) {
      const stopCount = trips.length; // each Trip record ends in a stop
      const totalDistanceKm = trips.reduce((sum, t) => sum + (t.distance || 0), 0);
      const totalMiles = totalDistanceKm * 0.621371;

      el.stops().textContent = stopCount;
      el.mileage().textContent = totalMiles.toFixed(1);

      updateCashCalc(totalMiles, currentFuelGallons);
    }, function (err) {
      console.error('Get Trip failed', err);
      el.stops().textContent = 'err';
      el.mileage().textContent = 'err';
    });
  }

  // ---- Fuel usage via StatusData ----
  // Fuel-used diagnostics vary by device/engine type. This looks up the
  // standard "Fuel Used" diagnostic id once, then pulls StatusData for it.
  // NOTE: on some fleets this may need to be "Fuel Used (Trip)" or a
  // device-specific diagnostic — confirm the exact name in MyGeotab >
  // Engine & Maintenance > Diagnostics if numbers look off.
  let currentFuelGallons = 0;

  function loadFuel(deviceId, fromDate, toDate) {
    // Geotab predefines a fixed diagnostic ID for fuel used, independent of
    // whatever display name your database uses. Query StatusData with it
    // directly instead of searching Diagnostic by name.
    api.call('Get', {
      typeName: 'StatusData',
      search: {
        deviceSearch: { id: deviceId },
        diagnosticSearch: { id: 'DiagnosticFuelUsedId' },
        fromDate,
        toDate
      }
    }, function (statusData) {
      console.log('[FuelWolf] StatusData (DiagnosticFuelUsedId) rows:', statusData.length, statusData);
      if (statusData.length) {
        const totalLiters = statusData.reduce((sum, s) => sum + (s.data || 0), 0);
        currentFuelGallons = totalLiters * 0.264172;
        el.fuel().textContent = currentFuelGallons.toFixed(1);
        updateCashCalc(currentTotalMiles, currentFuelGallons);
      } else {
        // Fallback: some devices/engine types populate fuel on the Trip
        // record itself rather than as a separate StatusData stream.
        console.log('[FuelWolf] No StatusData for DiagnosticFuelUsedId, trying Trip.fuelUsed fallback');
        loadFuelFromTrips(deviceId, fromDate, toDate);
      }
    }, function (err) {
      console.error('Get StatusData (fuel) failed', err);
      console.log('[FuelWolf] Falling back to Trip.fuelUsed after StatusData error');
      loadFuelFromTrips(deviceId, fromDate, toDate);
    });
  }

  function loadFuelFromTrips(deviceId, fromDate, toDate) {
    api.call('Get', {
      typeName: 'Trip',
      search: { deviceSearch: { id: deviceId }, fromDate, toDate }
    }, function (trips) {
      console.log('[FuelWolf] Trip records for fuel fallback:', trips);
      const totalLiters = trips.reduce((sum, t) => sum + (t.fuelUsed || 0), 0);
      if (totalLiters > 0) {
        currentFuelGallons = totalLiters * 0.264172;
        el.fuel().textContent = currentFuelGallons.toFixed(1);
        updateCashCalc(currentTotalMiles, currentFuelGallons);
      } else {
        el.fuel().textContent = 'n/a';
        console.warn('[FuelWolf] No fuel data found via StatusData or Trip.fuelUsed for this device/range.');
      }
    }, function (err) {
      console.error('Get Trip (fuel fallback) failed', err);
      el.fuel().textContent = 'err';
    });
  }

  let currentTotalMiles = 0;

  // ---- HOS clocks ----
  // DutyStatusAvailability is keyed by driver, not device, so this needs
  // the driver currently associated with the device. For a first pass we
  // pull the most recent DriverChange record for the device to find the
  // driver, then fetch their duty status availability.
  function loadHOS(deviceId) {
    api.call('Get', {
      typeName: 'DriverChange',
      search: { deviceSearch: { id: deviceId } },
      resultsLimit: 1,
      sort: { sortBy: 'dateTime', sortDirection: 'desc' }
    }, function (changes) {
      if (!changes.length || !changes[0].driver) {
        el.hosDrive().textContent = 'n/a';
        el.hosDuty().textContent = 'n/a';
        return;
      }
      const driverId = changes[0].driver.id;

      api.call('Get', {
        typeName: 'DutyStatusAvailability',
        search: { driverSearch: { id: driverId } }
      }, function (avail) {
        if (!avail.length) {
          el.hosDrive().textContent = 'n/a';
          el.hosDuty().textContent = 'n/a';
          return;
        }
        const a = avail[0];
        el.hosDrive().textContent = formatDuration(a.driveRemaining);
        el.hosDuty().textContent = formatDuration(a.dutyRemaining);
      }, function (err) {
        console.error('Get DutyStatusAvailability failed', err);
        el.hosDrive().textContent = 'err';
        el.hosDuty().textContent = 'err';
      });
    }, function (err) {
      console.error('Get DriverChange failed', err);
    });
  }

  function formatDuration(isoDuration) {
    // Geotab often returns HOS durations as ISO 8601 (e.g. "PT5H30M").
    // Simple parse for hours/minutes display.
    if (!isoDuration) return 'n/a';
    const match = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(isoDuration);
    if (!match) return isoDuration;
    const h = match[1] || '0';
    const m = match[2] || '0';
    return `${h}h ${m}m`;
  }

  // ---- Cash calculator ----
  function updateCashCalc(miles, fuelGallons) {
    currentTotalMiles = miles || currentTotalMiles;
    const rate = parseFloat(el.rateInput().value) || 0;
    const fuelPrice = parseFloat(el.fuelPriceInput().value) || 0;

    const grossPay = currentTotalMiles * rate;
    const fuelCost = fuelGallons * fuelPrice;
    const net = grossPay - fuelCost;

    el.grossPay().textContent = `$${grossPay.toFixed(2)}`;
    el.fuelCost().textContent = `$${fuelCost.toFixed(2)}`;
    el.net().textContent = `$${net.toFixed(2)}`;
  }

  // ---- Pull everything for the current device + range ----
  function refreshDashboard() {
    if (!currentDeviceId) return;
    const { fromDate, toDate } = getRangeDates(currentRange);
    loadTrips(currentDeviceId, fromDate, toDate);
    loadFuel(currentDeviceId, fromDate, toDate);
    loadHOS(currentDeviceId);
  }

  // ---- Wire up UI events ----
  function bindEvents() {
    el.deviceSelect().addEventListener('change', function (e) {
      currentDeviceId = e.target.value;
      refreshDashboard();
    });

    el.rangeBtns().forEach(btn => {
      btn.addEventListener('click', function () {
        el.rangeBtns().forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentRange = btn.dataset.range;
        refreshDashboard();
      });
    });

    el.rateInput().addEventListener('input', () => updateCashCalc());
    el.fuelPriceInput().addEventListener('input', () => updateCashCalc());
  }

  return {
    initialize: function (freshApi, state, callback) {
      api = freshApi;
      bindEvents();
      loadDevices();
      callback();
    },

    focus: function (freshApi, state) {
      api = freshApi;
      refreshDashboard();
    },

    blur: function () {
      // Nothing to tear down for now.
    }
  };
};
