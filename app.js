/* ==========================================================================
   RADUGA // APPLE-STYLE MINIMALIST TELEMETRY CONTROLLER
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  // --- UI Elements ---
  const navClock = document.getElementById("nav-clock");
  const gpsStatusBadge = document.getElementById("gps-status-badge");
  
  // HUD Overlays
  const hudSpeedVal = document.getElementById("hud-speed-val");
  const snapFlash = document.getElementById("snap-flash");

  // Monitor Grid — 6 live cells
  const MONITOR_COUNT = 6;
  const monitorCanvases = [];
  const monitorCtxs = [];
  for (let i = 0; i < MONITOR_COUNT; i++) {
    const mc = document.getElementById(`mcanvas-${i}`);
    if (mc) {
      monitorCanvases.push(mc);
      monitorCtxs.push(mc.getContext("2d"));
    }
  }
  let currentCellIndex = 0; // which cell to flash next
  
  // Controls
  const speedSlider = document.getElementById("speed-slider");
  const sliderSpeedVal = document.getElementById("slider-speed-val");
  const coordsLatLng = document.getElementById("coords-lat-lng");
  const coordsHead = document.getElementById("coords-head");
  
  const btnCameraPower = document.getElementById("btn-camera-power");
  const btnFilterCycle = document.getElementById("btn-filter-cycle");
  const btnAutoPilot = document.getElementById("btn-auto-pilot");
  
  const videoFeed = document.getElementById("webcam-feed");
  const riderCanvas = document.getElementById("rider-canvas");
  const riderCtx = riderCanvas.getContext("2d", { willReadFrequently: true });
  
  const chartCanvas = document.getElementById("speed-chart");
  const chartCtx = chartCanvas ? chartCanvas.getContext("2d") : null;

  // --- State Variables ---
  let currentSpeed = 45; // km/h
  let targetSpeed = 45; // for smooth easing
  let autoDriveActive = false;
  let cameraActive = false;
  let activeFilter = "THERMAL"; // THERMAL, CINEMATIC, GRAYSCALE, STANDARD

  // --- Gallery Rotation State ---
  const galleryCards = [];
  let currentGalleryIndex = 0;

  // --- API State Variables ---
  let apiActive = false;
  let apiData = { x: 2500, y: 1500, rotation: 0 };
  let apiFailureCount = 0;

  // --- Camera & Telemetry Sharing (Host) ---
  const cameraChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('camera-shared-stream') : null;
  let childWindows = [];

  // Hidden canvas for resizing/sending raw camera frames
  const sharingCanvas = document.createElement("canvas");
  sharingCanvas.width = 640;
  sharingCanvas.height = 360;
  const sharingCtx = sharingCanvas.getContext("2d");
  let lastShareTime = 0;

  // Offscreen canvas for thermal pixel processing (240x135 for retro pixelation + ultra high performance)
  const thermalCanvas = document.createElement("canvas");
  thermalCanvas.width = 240;
  thermalCanvas.height = 135;
  const thermalCtx = thermalCanvas.getContext("2d", { willReadFrequently: true });

  // Thermal Color Lookup Table (LUT) - Ironbow Fire & Ice Gradient
  const thermalLUT = new Uint8ClampedArray(256 * 3);
  function initThermalLUT() {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    const grad = ctx.createLinearGradient(0, 0, 256, 0);
    // 0 ~ 70: Cold ambient background (Deep Navy / Indigo Blue)
    // 70 ~ 130: Transition cool to warm (Teal / Violet / Ochre)
    // 130 ~ 210: High Heat (Vibrant Crimson Red / Fiery Flame Red)
    // 210 ~ 255: Extreme Peak Heat (Amber Yellow / White-Hot Core)
    // Authentic FLIR Ironbow Fire & Ice Thermal Color Spectrum
    grad.addColorStop(0.00, "rgb(2, 4, 18)");       // 0: Deep space navy black
    grad.addColorStop(0.12, "rgb(6, 20, 95)");      // 30: Cold background navy blue
    grad.addColorStop(0.25, "rgb(0, 110, 175)");    // 64: Cool Teal / Cyan
    grad.addColorStop(0.38, "rgb(75, 15, 125)");    // 97: Deep Purple / Violet
    grad.addColorStop(0.52, "rgb(175, 10, 60)");    // 133: Magenta / Dark Crimson
    grad.addColorStop(0.66, "rgb(235, 30, 10)");    // 168: Fiery Flame Red
    grad.addColorStop(0.80, "rgb(255, 120, 0)");    // 204: Vibrant Blaze Orange
    grad.addColorStop(0.92, "rgb(255, 225, 20)");   // 235: Bright Yellow-Hot
    grad.addColorStop(1.00, "rgb(255, 255, 255)");  // 255: White-Hot Core
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 1);
    const data = ctx.getImageData(0, 0, 256, 1).data;
    for (let i = 0; i < 256; i++) {
      thermalLUT[i * 3] = data[i * 4];
      thermalLUT[i * 3 + 1] = data[i * 4 + 1];
      thermalLUT[i * 3 + 2] = data[i * 4 + 2];
    }
  }
  initThermalLUT();

  // Motion Detection & Human Heat Tracking Buffers (240x135)
  const prevLumaBuffer = new Float32Array(240 * 135);
  const motionHeatMap = new Float32Array(240 * 135);

  const mainMediaCard = document.getElementById("main-media-card");
  const thermalFaceBox = document.getElementById("thermal-face-box");
  const thermalTempVal = document.getElementById("thermal-temp-val");
  const thermalMetaDate = document.getElementById("thermal-meta-date");
  const thermalXVal = document.getElementById("thermal-x-val");
  const thermalYVal = document.getElementById("thermal-y-val");

  function updateFilterUI() {
    if (activeFilter === "THERMAL") {
      mainMediaCard.classList.add("mode-thermal");
    } else {
      mainMediaCard.classList.remove("mode-thermal");
    }
  }
  
  function getNonLinearSpeedRatio(speed) {
    if (speed <= 0) return 0;
    const ratio = Math.min(1.0, speed / 150);
    return Math.pow(ratio, 0.4);
  }

  function pingPong(val, min, max) {
    const range = max - min;
    const doubled = range * 2;
    const modulo = ((val - min) % doubled + doubled) % doubled;
    return modulo < range ? min + modulo : min + doubled - modulo;
  }

  let gpsCoords = {
    lat: 37.566532,
    lng: 126.978012,
    heading: 184.2,
    x: 0,
    y: 0
  };
  
  let currentBoxX = 50; // smooth easing X percentage
  let currentBoxY = 36; // smooth easing Y percentage
  
  let speedHistory = Array(35).fill(45);
  let animationTime = 0;
  let snapshotIntervalId = null;
  let mainLoopId = null;
  let captureCount = 0; // Total capture counter

  // Joystick Resistance variables
  let currentResistance = 0;
  let resistanceHistory = Array(100).fill(0);
  
  const resistanceVal = document.getElementById("resistance-val");
  const resistanceBarFill = document.getElementById("resistance-bar-fill");
  const resistanceChartCanvas = document.getElementById("resistance-trend-chart");
  const resistanceChartCtx = resistanceChartCanvas ? resistanceChartCanvas.getContext("2d") : null;
  const terrainTooltip = document.getElementById("terrain-tooltip");
  const resistanceChartContainer = document.getElementById("resistance-chart-container");

  // Dynamic Thermal tracking variables
  let thermalHeatMultiplier = 1.5;
  let patrolX = 160;
  let patrolY = 82;
  let faceTracker = null;
  let trackerTask = null;
  let lastDetectedFace = null;
  
  const calFactorVal = document.getElementById("cal-factor-val");
  const thermalFactorSlider = document.getElementById("thermal-factor-slider");
  const calCorrelationBar = document.getElementById("cal-correlation-bar");

  // Dynamic Scale Calibration
  let maxScaleTemp = 80;
  const scaleBarWrapper = document.getElementById("scale-bar-wrapper");
  const scaleIndicator = document.getElementById("scale-indicator");
  const tick0 = document.getElementById("scale-tick-0");
  const tick1 = document.getElementById("scale-tick-1");
  const tick2 = document.getElementById("scale-tick-2");
  const tick3 = document.getElementById("scale-tick-3");
  const tick4 = document.getElementById("scale-tick-4");



  // --- Audio Synthesizer (Sleek Apple Haptic Chime) ---
  let audioCtx = null;
  
  function playHapticTap(freq = 1400, duration = 0.03, volume = 0.015) {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      // Soft pitch decay
      osc.frequency.exponentialRampToValueAtTime(freq / 1.5, audioCtx.currentTime + duration);
      
      gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
      
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
      // Audio context blocked
    }
  }

  // --- Face Tracker & Human Detection Initialization ---
  let lastFaceDetectedTime = 0;
  let smoothFace = { x: 0, y: 0, width: 0, height: 0, active: false };
  let detectedUserCenter = { x: 50, y: 40, active: false };

  function initFaceTracker() {
    if (typeof tracking !== "undefined") {
      faceTracker = new tracking.ObjectTracker("face");
      // Fast scan parameters to reduce main thread CPU overhead
      faceTracker.setInitialScale(1.4);
      faceTracker.setStepSize(1.6);
      faceTracker.setEdgesDensity(0.1);
      
      faceTracker.on("track", (event) => {
        if (event.data && event.data.length > 0) {
          // Find the largest face (closest to camera)
          let largestFace = event.data[0];
          for (let i = 1; i < event.data.length; i++) {
            if (event.data[i].width * event.data[i].height > largestFace.width * largestFace.height) {
              largestFace = event.data[i];
            }
          }
          lastDetectedFace = largestFace;
          lastFaceDetectedTime = performance.now();
          smoothFace.active = true;
          
          // Smoothly lerp tracker box
          smoothFace.x = smoothFace.x ? lerp(smoothFace.x, largestFace.x, 0.3) : largestFace.x;
          smoothFace.y = smoothFace.y ? lerp(smoothFace.y, largestFace.y, 0.3) : largestFace.y;
          smoothFace.width = smoothFace.width ? lerp(smoothFace.width, largestFace.width, 0.3) : largestFace.width;
          smoothFace.height = smoothFace.height ? lerp(smoothFace.height, largestFace.height, 0.3) : largestFace.height;
        } else {
          // If face is temporarily lost (e.g. tilted/blinked), remember last position for 4 seconds
          if (performance.now() - lastFaceDetectedTime > 4000) {
            lastDetectedFace = null;
            smoothFace.active = false;
          }
        }
      });
    }
  }

  // --- API Connection (Render API) ---
  function updateApiStatusBadge(status) {
    const apiStatusBadge = document.getElementById("api-status-badge");
    if (apiStatusBadge) {
      if (status === true || status === "active") {
        apiStatusBadge.textContent = "API ACTIVE (RENDER)";
        apiStatusBadge.className = "status-pill active-success";
        apiStatusBadge.style.background = "rgba(48, 209, 88, 0.15)";
        apiStatusBadge.style.color = "#30d158";
        apiStatusBadge.style.borderColor = "rgba(48, 209, 88, 0.4)";
      } else if (status === "connecting") {
        apiStatusBadge.textContent = "CONNECTING...";
        apiStatusBadge.className = "status-pill";
        apiStatusBadge.style.background = "rgba(255, 159, 10, 0.15)";
        apiStatusBadge.style.color = "#ff9f0a";
        apiStatusBadge.style.borderColor = "rgba(255, 159, 10, 0.4)";
      } else {
        apiStatusBadge.textContent = "API OFFLINE";
        apiStatusBadge.className = "status-pill";
        apiStatusBadge.style.background = "rgba(255, 255, 255, 0.08)";
        apiStatusBadge.style.color = "#8e8e93";
        apiStatusBadge.style.borderColor = "rgba(255, 255, 255, 0.15)";
      }
    }
  }  function pollPositionAPI() {
    const RENDER_API_URL = "https://position-api-generator.onrender.com/api/state";
    const PROXY_API_URL = "/api/proxy-state";
    updateApiStatusBadge("connecting");

    function processPayload(data) {
      if (data && typeof data.x === 'number' && typeof data.y === 'number') {
        apiData = data;
        apiActive = true;
        apiFailureCount = 0;

        // Capture start trajectory state for smooth zero-jump transition
        apiLastFetchTime = performance.now();
        apiStartCanvasX = patrolX;
        apiStartCanvasY = patrolY;
        apiStartSliderX = currentMappedSliderX;
        apiStartSliderY = currentMappedSliderY;

        updateApiStatusBadge("active");
        if (typeof updateObjectControllerUI === "function") {
          updateObjectControllerUI();
        }
        return true;
      }
      return false;
    }

    function fetchRenderAPI() {
      fetch(RENDER_API_URL)
        .then(res => {
          if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
          return res.json();
        })
        .then(data => {
          if (!processPayload(data)) throw new Error("Invalid API data format");
        })
        .catch(() => {
          // Try local proxy route if direct fetch fails (e.g. CORS or local security restriction)
          fetch(PROXY_API_URL)
            .then(res => res.json())
            .then(data => {
              if (!processPayload(data)) throw new Error("Invalid Proxy payload");
            })
            .catch(err => {
              apiFailureCount++;
              if (apiFailureCount >= 3) {
                apiActive = false;
                updateApiStatusBadge(false);
                if (typeof updateObjectControllerUI === "function") {
                  updateObjectControllerUI();
                }
              }
            });
        });
    }

    // Run immediate fetch on startup (handles initial load without waiting 2s)
    fetchRenderAPI();
    // Poll every 2 seconds
    setInterval(fetchRenderAPI, 2000);
  }

  // --- 1. Top Bar Clock ---
  function startClock() {
    function updateClock() {
      const now = new Date();
      const hrs = String(now.getHours()).padStart(2, '0');
      const mins = String(now.getMinutes()).padStart(2, '0');
      const secs = String(now.getSeconds()).padStart(2, '0');
      navClock.textContent = `${hrs}:${mins}:${secs}`;
    }
    setInterval(updateClock, 1000);
    updateClock();
  }

  // --- 2. Telemetry and Object Position Controller logic ---
  let isManualSpeedOverride = false;
  let manualSpeedTimer = null;
  let isDraggingSlider = false;

  function updateSpeedGauge(val, syncSlider = true) {
    currentSpeed = Math.max(0, Math.min(150, val));
    if (hudSpeedVal) hudSpeedVal.textContent = Math.round(currentSpeed);
    if (sliderSpeedVal) sliderSpeedVal.textContent = `${Math.round(currentSpeed)} KM/H`;
    if (syncSlider && speedSlider && !isDraggingSlider) {
      speedSlider.value = Math.round(currentSpeed);
    }
    
    // speed scale calculation
    const factor = (currentSpeed / 45).toFixed(1);
    const vFactorLbl = document.getElementById('v-factor-lbl');
    if (vFactorLbl) vFactorLbl.textContent = `V_FACTOR: ${factor}x`;
  }

  // Linear Interpolation for smooth movement easing
  function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
  }

  // --- Object Position Controller State ---
  const ctrlXSlider = document.getElementById("ctrl-x-slider");
  const ctrlYSlider = document.getElementById("ctrl-y-slider");
  const btnCtrlReset = document.getElementById("btn-ctrl-reset");
  const controllerCoordsVal = document.getElementById("controller-coords-val");
  const vhsCtrlStatus = document.getElementById("vhs-ctrl-status");

  let targetUserOffsetX = 0;
  let targetUserOffsetY = 0;
  let userOffsetX = 0;
  let userOffsetY = 0;

  // Heat factor driven by how far the X/Y controller is pushed from center (0 = coldest, 1 = hottest)
  let targetControllerHeatFactor = 0;
  let controllerHeatFactor = 0;

  // Arduino-style map() function: map(x, in_min, in_max, out_min, out_max)
  function arduinoMap(x, inMin, inMax, outMin, outMax) {
    return (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
  }

  // Smooth time-aware trajectory state for 60FPS continuous gliding interpolation
  let apiLastFetchTime = 0;
  let apiStartCanvasX = 0;
  let apiStartCanvasY = 0;

  let currentMappedSliderX = 0;
  let currentMappedSliderY = 0;
  let apiStartSliderX = 0;
  let apiStartSliderY = 0;
  let targetMappedSliderX = 0;
  let targetMappedSliderY = 0;

  // Direct 1-to-1 linear mapping using Arduino map(), constrained to 80% of visual box centered at origin
  function reinterpretApiCoordinates() {
    if (!apiActive || !apiData) return;

    const rawX = typeof apiData.x === 'number' ? apiData.x : 2500;
    const rawY = typeof apiData.y === 'number' ? apiData.y : 2500;

    // Arduino map(): 0~5000 mapped to -80~+80 (80% visual box limit around center 2500)
    const mappedX = arduinoMap(rawX, 0, 5000, -80, 80);
    const mappedY = arduinoMap(rawY, 0, 5000, -80, 80);

    targetMappedSliderX = Math.max(-80, Math.min(80, Math.round(mappedX)));
    targetMappedSliderY = Math.max(-80, Math.min(80, Math.round(mappedY)));
  }

  function syncSlidersWithAPI() {
    if (apiActive && apiData) {
      reinterpretApiCoordinates();
      
      // Calculate smoothstep progress t in [0, 1] over 2000ms polling interval
      const elapsedMs = performance.now() - apiLastFetchTime;
      const progressT = Math.max(0, Math.min(1, elapsedMs / 2000));
      // Smoothstep cubic curve: 3*t^2 - 2*t^3
      const smoothT = progressT * progressT * (3 - 2 * progressT);

      currentMappedSliderX = apiStartSliderX + (targetMappedSliderX - apiStartSliderX) * smoothT;
      currentMappedSliderY = apiStartSliderY + (targetMappedSliderY - apiStartSliderY) * smoothT;

      if (ctrlXSlider) {
        ctrlXSlider.value = Math.round(currentMappedSliderX);
      }
      if (ctrlYSlider) {
        ctrlYSlider.value = Math.round(currentMappedSliderY);
      }
    }
  }

  function updateRawApiDataDisplay() {
    const apiRawX = document.getElementById("api-raw-x");
    const apiRawY = document.getElementById("api-raw-y");
    const apiRawRot = document.getElementById("api-raw-rot");
    const apiRawAct = document.getElementById("api-raw-act");
    const apiRawTime = document.getElementById("api-raw-time");

    if (apiActive && apiData) {
      if (apiRawX) apiRawX.textContent = typeof apiData.x === 'number' ? apiData.x.toFixed(2) : (apiData.x ?? "--");
      if (apiRawY) apiRawY.textContent = typeof apiData.y === 'number' ? apiData.y.toFixed(2) : (apiData.y ?? "--");
      if (apiRawRot) apiRawRot.textContent = `${apiData.rotation ?? 0}°`;
      if (apiRawAct) apiRawAct.textContent = apiData.action ?? "--";
      if (apiRawTime) {
        const t = new Date();
        const timeStr = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
        apiRawTime.textContent = `SYNC @ ${timeStr}`;
      }
    } else {
      if (apiRawX) apiRawX.textContent = "--";
      if (apiRawY) apiRawY.textContent = "--";
      if (apiRawRot) apiRawRot.textContent = "--°";
      if (apiRawAct) apiRawAct.textContent = "--";
      if (apiRawTime) apiRawTime.textContent = "API OFFLINE";
    }
  }

  function updateObjectControllerUI() {
    if (apiActive && apiData) {
      syncSlidersWithAPI();
    }
    updateRawApiDataDisplay();

    const rawX = ctrlXSlider ? parseInt(ctrlXSlider.value) : 0;
    const rawY = ctrlYSlider ? parseInt(ctrlYSlider.value) : 0;

    // Map -100 ~ 100 range to thermal canvas pixel offset (Expanded travel range: 85% width / 70% height for dramatic visual feedback)
    targetUserOffsetX = (rawX / 100) * (thermalCanvas.width * 0.85);
    targetUserOffsetY = (rawY / 100) * (thermalCanvas.height * 0.70);

    // Distance from center (0~100), further push = hotter temperature reading & color
    targetControllerHeatFactor = Math.min(1, Math.sqrt(rawX * rawX + rawY * rawY) / 141.42);

    if (controllerCoordsVal) {
      if (apiActive && apiData) {
        controllerCoordsVal.textContent = `[API MAP 80%] X: ${apiData.x} (${rawX > 0 ? '+' : ''}${rawX}) | Y: ${apiData.y} (${rawY > 0 ? '+' : ''}${rawY}) | ROT: ${apiData.rotation ?? 0}°`;
        controllerCoordsVal.style.color = "#30d158";
      } else {
        const isAuto = (rawX === 0 && rawY === 0);
        const modeText = isAuto ? "(AUTO FLOAT)" : "(MANUAL STEER)";
        controllerCoordsVal.textContent = `X: ${rawX > 0 ? '+' : ''}${rawX} | Y: ${rawY > 0 ? '+' : ''}${rawY} ${modeText}`;
        controllerCoordsVal.style.color = "#00e5ff";
      }
    }
    if (vhsCtrlStatus) {
      if (apiActive) {
        vhsCtrlStatus.textContent = "API MAP 80% SYNC";
      } else {
        const isAuto = (rawX === 0 && rawY === 0);
        vhsCtrlStatus.textContent = isAuto ? "AUTO FLOAT" : "MANUAL STEER";
      }
    }
  }

  if (ctrlXSlider) {
    ctrlXSlider.addEventListener("input", () => {
      playHapticTap(900 + Math.abs(parseInt(ctrlXSlider.value)), 0.015, 0.01);
      updateObjectControllerUI();
    });
  }
  if (ctrlYSlider) {
    ctrlYSlider.addEventListener("input", () => {
      playHapticTap(900 + Math.abs(parseInt(ctrlYSlider.value)), 0.015, 0.01);
      updateObjectControllerUI();
    });
  }
  if (btnCtrlReset) {
    btnCtrlReset.addEventListener("click", () => {
      playHapticTap(1200, 0.04, 0.02);
      if (ctrlXSlider) ctrlXSlider.value = "0";
      if (ctrlYSlider) ctrlYSlider.value = "0";
      updateObjectControllerUI();
    });
  }

  // Keyboard Arrow Keys support for smooth control
  window.addEventListener("keydown", (e) => {
    if (!ctrlXSlider || !ctrlYSlider) return;
    // Only intercept if user is not typing in an input text field
    if (e.target && (e.target.tagName === 'INPUT' && e.target.type === 'text')) return;

    let step = 10;
    if (e.key === "ArrowLeft") {
      ctrlXSlider.value = Math.max(-100, parseInt(ctrlXSlider.value) - step);
      updateObjectControllerUI();
    } else if (e.key === "ArrowRight") {
      ctrlXSlider.value = Math.min(100, parseInt(ctrlXSlider.value) + step);
      updateObjectControllerUI();
    } else if (e.key === "ArrowUp") {
      ctrlYSlider.value = Math.max(-100, parseInt(ctrlYSlider.value) - step);
      updateObjectControllerUI();
    } else if (e.key === "ArrowDown") {
      ctrlYSlider.value = Math.min(100, parseInt(ctrlYSlider.value) + step);
      updateObjectControllerUI();
    }
  });

  function simulateTelemetry() {
    animationTime += 0.01;
    
    if (!isManualSpeedOverride) {
      if (apiActive) {
        // Map API y (0 ~ 5000) to speed (0 ~ 150 KM/H)
        targetSpeed = Math.max(0, Math.min(150, (apiData.y / 5000) * 150));
        // Map API x (0 ~ 5000) to resistance (0 ~ 100 %)
        currentResistance = Math.max(0, Math.min(100, Math.round((apiData.x / 5000) * 100)));
      } else {
        if (autoDriveActive) {
          let baseSpeed = 55;
          targetSpeed = baseSpeed 
            + Math.sin(animationTime * 0.4) * 22 
            + Math.cos(animationTime * 1.5) * 6;
          targetSpeed = Math.max(0, Math.min(145, targetSpeed));
        }
      }
    }

    if (!isDraggingSlider) {
      // Apply smooth interpolation to current speed
      const easedSpeed = lerp(currentSpeed, targetSpeed, 0.25);
      updateSpeedGauge(easedSpeed, !isManualSpeedOverride);
    }

    // Save history
    speedHistory.push(currentSpeed);
    speedHistory.shift();

    if (!apiActive) {
      // Joystick Resistance Simulation (Dynamic connection to speed & physical sensor jitter)
      if (currentSpeed <= 0.05) {
        currentResistance = 0;
      } else {
        let baseRes = 35;
        let resWave = Math.sin(animationTime * 2.0) * 20 + Math.cos(animationTime * 0.8) * 10;
        let speedInfluence = (currentSpeed / 150) * 35;
        // High-frequency jitter to represent real-time active load
        let jitter = (Math.random() - 0.5) * 6;
        currentResistance = Math.max(1, Math.min(100, Math.round(baseRes + resWave + speedInfluence + jitter)));
      }
    }
    
    resistanceHistory.push(currentResistance);
    resistanceHistory.shift();

    // Lat/Lng translation
    const speedMS = (currentSpeed * 0.278) / 60;
    const rad = (gpsCoords.heading * Math.PI) / 180;
    gpsCoords.lat += (speedMS * Math.cos(rad)) / 111111;
    gpsCoords.lng += (speedMS * Math.sin(rad)) / 88888;
    
    gpsCoords.heading += (Math.random() - 0.5) * (currentSpeed / 24);

    // Accumulate relative local x, y coordinates
    const dt = 0.05; // fixed time step for smooth UI displacement
    gpsCoords.x += currentSpeed * Math.cos(rad) * dt;
    gpsCoords.y += currentSpeed * Math.sin(rad) * dt;

    // Update GPS DOM text
    if (coordsLatLng) coordsLatLng.textContent = `${gpsCoords.lat.toFixed(5)}° N / ${gpsCoords.lng.toFixed(5)}° E`;
    if (coordsHead) coordsHead.textContent = `${gpsCoords.heading.toFixed(1)}° (${getCompassDirection(gpsCoords.heading)})`;
  }

  function getCompassDirection(deg) {
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const idx = Math.round(deg / 45) % 8;
    return dirs[idx];
  }

  // --- Raduga UI Toast & Notifications ---
  let toastContainer = null;
  function showToast(title, desc, type = "info", actionBtn = null) {
    if (!toastContainer) {
      toastContainer = document.createElement("div");
      toastContainer.className = "raduga-toast-container";
      document.body.appendChild(toastContainer);
    }
    const toast = document.createElement("div");
    toast.className = `raduga-toast toast-${type}`;
    
    let icon = "ℹ️";
    if (type === "error") icon = "⚠️";
    if (type === "warning") icon = "🔔";
    if (type === "success") icon = "✅";

    let actionHtml = "";
    if (actionBtn && actionBtn.text && actionBtn.url) {
      actionHtml = `<a href="${actionBtn.url}" class="toast-action-btn" target="_blank">${actionBtn.text}</a>`;
    } else if (actionBtn && actionBtn.text && actionBtn.onClick) {
      actionHtml = `<button class="toast-action-btn">${actionBtn.text}</button>`;
    }

    toast.innerHTML = `
      <div class="toast-icon">${icon}</div>
      <div class="toast-body">
        <div class="toast-title">${title}</div>
        <div class="toast-desc">${desc}</div>
        ${actionHtml}
      </div>
      <button class="toast-close-btn">&times;</button>
    `;

    toast.querySelector(".toast-close-btn").addEventListener("click", () => {
      toast.remove();
    });

    if (actionBtn && actionBtn.onClick) {
      const btn = toast.querySelector(".toast-action-btn");
      if (btn) {
        btn.addEventListener("click", () => {
          actionBtn.onClick();
          toast.remove();
        });
      }
    }

    toastContainer.appendChild(toast);
    setTimeout(() => {
      if (toast.parentElement) {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(16px)";
        setTimeout(() => toast.remove(), 350);
      }
    }, 7000);
  }

  function addEventLog(msg) {
    console.log(`[Raduga Telemetry] ${msg}`);
  }

  // Check file:// protocol warning on load
  if (window.location.protocol === "file:") {
    const banner = document.createElement("div");
    banner.className = "file-protocol-banner";
    banner.innerHTML = `
      <span>⚠️ 로컬 파일(file://)로 접속되었습니다. 크롬 보안 정책상 카메라 연동을 위해 로컬 서버 실행이 권장됩니다.</span>
      <code>node server.js</code>
      <a href="http://localhost:3000/산학%206번%20데이터:홈페이지/index.html" target="_self">http://localhost:3000 으로 열기</a>
    `;
    document.body.prepend(banner);
  }

  // --- 3. Camera Controls & Captures ---
  function setupWebcamCanvas() {
    riderCanvas.width = 1280;
    riderCanvas.height = 720;
  }

  async function requestUserCameraStream() {
    // Check if mediaDevices API is supported
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const legacyGetUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
      if (!legacyGetUserMedia) {
        throw new Error("MEDIA_DEVICES_UNSUPPORTED");
      }
      return new Promise((resolve, reject) => {
        legacyGetUserMedia.call(navigator, { video: true, audio: false }, resolve, reject);
      });
    }

    // Try ideal high quality HD constraint first
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          facingMode: "user"
        },
        audio: false
      });
    } catch (err) {
      console.warn("High-res constraint failed, falling back to standard video constraint:", err);
      // Fallback 1: Standard definition
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: "user"
          },
          audio: false
        });
      } catch (err2) {
        console.warn("Standard constraint failed, falling back to basic video:", err2);
        // Fallback 2: Plain video
        return await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });
      }
    }
  }

  async function startWebcam() {
    if (btnCameraPower) btnCameraPower.textContent = "Connecting...";
    try {
      const stream = await requestUserCameraStream();
      videoFeed.srcObject = stream;

      // Wait until video metadata is loaded and video is playing
      await new Promise((resolve) => {
        if (videoFeed.readyState >= 2) {
          resolve();
        } else {
          videoFeed.onloadedmetadata = () => {
            resolve();
          };
          setTimeout(resolve, 3000);
        }
      });

      try {
        await videoFeed.play();
      } catch (playErr) {
        console.warn("Video play promise error (often harmless):", playErr);
      }

      cameraActive = true;
      if (btnCameraPower) {
        btnCameraPower.textContent = "Stop Camera";
        btnCameraPower.classList.add("active");
      }
      gpsStatusBadge.textContent = "GPS LOCKED & STREAMING";
      gpsStatusBadge.classList.add("active");

      const cameraStatusBadge = document.getElementById("camera-status-badge");
      if (cameraStatusBadge) {
        cameraStatusBadge.textContent = "CAM LINKED";
        cameraStatusBadge.style.background = "rgba(48, 209, 88, 0.15)";
        cameraStatusBadge.style.color = "#30d158";
        cameraStatusBadge.style.borderColor = "rgba(48, 209, 88, 0.3)";
      }

      // Stream track ended handler (e.g. camera unplugged)
      stream.getVideoTracks().forEach(track => {
        track.onended = () => {
          stopWebcam();
          showToast("카메라 연결 종료", "카메라 장치가 분리되었거나 중단되었습니다.", "warning");
        };
      });

      // Start face tracking
      if (faceTracker && !trackerTask) {
        try {
          trackerTask = tracking.track('#webcam-feed', faceTracker);
        } catch (tErr) {
          console.warn("Face tracker start error:", tErr);
        }
      }

      showToast("카메라 연동 성공", "웹캠 실시간 피드가 정상적으로 연결되었습니다.", "success");
    } catch (err) {
      console.error("Camera access failed:", err);
      cameraActive = false;
      if (btnCameraPower) {
        btnCameraPower.textContent = "Start Camera";
        btnCameraPower.classList.remove("active");
      }

      if (err.message === "MEDIA_DEVICES_UNSUPPORTED" || (window.location.protocol === "file:")) {
        showToast(
          "카메라 접근 제한 (보안 정책)",
          "크롬 보안 정책상 file:// 프로토콜에서는 카메라를 열 수 없습니다. 'node server.js'를 실행해 http://localhost:3000 으로 접속해주세요.",
          "error",
          {
            text: "서버로 열기 (http://localhost:3000)",
            url: "http://localhost:3000/산학%206번%20데이터:홈페이지/index.html"
          }
        );
      } else if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        showToast(
          "카메라 권한 거부됨",
          "크롬 주소창 좌측의 🔒 아이콘(또는 사이트 설정)을 클릭하여 '카메라 허용'으로 변경해주세요.",
          "error"
        );
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        showToast(
          "카메라 장치 없음",
          "사용 가능한 웹캠 장치를 찾을 수 없습니다. 외장/내장 카메라 연결을 확인해주세요.",
          "error"
        );
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        showToast(
          "카메라 사용 중",
          "다른 프로그램(FaceTime, Zoom, OBS 등)에서 카메라를 이미 사용 중일 수 있습니다.",
          "warning"
        );
      } else {
        showToast(
          "카메라 오류",
          `웹캠을 시작하지 못했습니다: ${err.message || err.name || '알 수 없는 오류'}`,
          "error"
        );
      }
    }
  }

  function stopWebcam() {
    const stream = videoFeed.srcObject;
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    videoFeed.srcObject = null;
    cameraActive = false;
    if (btnCameraPower) {
      btnCameraPower.textContent = "Start Camera";
      btnCameraPower.classList.remove("active");
    }
    gpsStatusBadge.textContent = "GPS LOCKED";
    gpsStatusBadge.classList.remove("active");

    const cameraStatusBadge = document.getElementById("camera-status-badge");
    if (cameraStatusBadge) {
      cameraStatusBadge.textContent = "CAM UNLINKED";
      cameraStatusBadge.style.background = "rgba(255, 69, 58, 0.12)";
      cameraStatusBadge.style.color = "#ff453a";
      cameraStatusBadge.style.borderColor = "rgba(255, 69, 58, 0.3)";
    }

    // Stop face tracking
    if (trackerTask) {
      trackerTask.stop();
      trackerTask = null;
      lastDetectedFace = null;
    }
  }

  if (btnCameraPower) {
    btnCameraPower.addEventListener("click", () => {
      playHapticTap(1200, 0.04, 0.02);
      if (!cameraActive) {
        startWebcam();
      } else {
        stopWebcam();
      }
    });
  }

  if (btnFilterCycle) {
    btnFilterCycle.addEventListener("click", () => {
      playHapticTap(1000, 0.03, 0.015);
      if (activeFilter === "THERMAL") {
        activeFilter = "CINEMATIC";
        btnFilterCycle.textContent = "Filter: Cinematic";
      } else if (activeFilter === "CINEMATIC") {
        activeFilter = "GRAYSCALE";
        btnFilterCycle.textContent = "Filter: Mono Grayscale";
      } else if (activeFilter === "GRAYSCALE") {
        activeFilter = "STANDARD";
        btnFilterCycle.textContent = "Filter: Clean Raw";
      } else {
        activeFilter = "THERMAL";
        btnFilterCycle.textContent = "Filter: Thermal";
      }
      updateFilterUI();
    });
  }

  if (btnAutoPilot) {
    btnAutoPilot.addEventListener("click", () => {
      playHapticTap(1100, 0.04, 0.02);
      autoDriveActive = !autoDriveActive;
      btnAutoPilot.classList.toggle("active", autoDriveActive);
      if (autoDriveActive) {
        addEventLog("AUTO CRUISE CONTROL ENGAGED");
      } else {
        addEventLog("AUTO CRUISE COMPLETED");
      }
    });
  }

  function processWebcamFeed() {
    const w = riderCanvas.width;
    const h = riderCanvas.height;

    // Share raw webcam frame to Screen 7 (Receiver) only when child windows are active
    if (cameraActive && videoFeed.srcObject && videoFeed.readyState === videoFeed.HAVE_ENOUGH_DATA) {
      const now = performance.now();
      if (childWindows.length > 0 && (now - lastShareTime > 100)) { // limit sharing to active sub-windows at 10 FPS
        lastShareTime = now;
        sharingCtx.drawImage(videoFeed, 0, 0, 640, 360);
        sharingCanvas.toBlob((blob) => {
          if (!blob) return;
          const msg = { type: 'frame', blob };
          if (cameraChannel) cameraChannel.postMessage(msg);
          childWindows = childWindows.filter(win => {
            try {
              if (win.closed) return false;
              win.postMessage(msg, '*');
              return true;
            } catch (e) {
              return false;
            }
          });
        }, 'image/jpeg', 0.5);
      }
    }
    
    if (activeFilter === "THERMAL") {
      const tw = thermalCanvas.width;
      const th = thermalCanvas.height;
      // Ease the controller-driven heat factor once per frame; downstream color/temp code reuses it
      controllerHeatFactor = lerp(controllerHeatFactor, targetControllerHeatFactor, 0.06);
      const speedHeatFactor = Math.pow(controllerHeatFactor, 0.75); // Controller push heat boost curve

      if (cameraActive && videoFeed.srcObject && videoFeed.readyState === videoFeed.HAVE_ENOUGH_DATA) {
        // Draw current webcam frame to offscreen canvas
        thermalCtx.drawImage(videoFeed, 0, 0, tw, th);
        const imgData = thermalCtx.getImageData(0, 0, tw, th);
        const pixels = imgData.data;

        // Calculate face and upper body heat center if face is detected (or smoothed from memory)
        let hasFace = false;
        let headCx = 0, headCy = 0, headR = 0;
        let bodyCx = 0, bodyCy = 0, bodyRx = 0, bodyRy = 0;

        if (smoothFace.active && smoothFace.width > 0) {
          hasFace = true;
          const vw = videoFeed.videoWidth || 1280;
          const vh = videoFeed.videoHeight || 720;
          const fx = (smoothFace.x / vw) * tw;
          const fy = (smoothFace.y / vh) * th;
          const fw = (smoothFace.width / vw) * tw;
          const fh = (smoothFace.height / vh) * th;

          headCx = fx + fw * 0.5;
          headCy = fy + fh * 0.5;
          headR = Math.max(fw, fh) * 0.85;

          bodyCx = headCx;
          bodyCy = headCy + fh * 1.6;
          bodyRx = fw * 2.0;
          bodyRy = fh * 2.5;
        }

        // Center fallback prior for desk user in front of camera (subtle localized weight)
        const defaultHeadCx = tw * 0.5;
        const defaultHeadCy = th * 0.45;
        const defaultHeadR = Math.min(tw, th) * 0.25;
        const defaultBodyCx = defaultHeadCx;
        const defaultBodyCy = defaultHeadCy + defaultHeadR * 1.3;
        const defaultBodyRx = defaultHeadR * 1.4;
        const defaultBodyRy = defaultHeadR * 1.6;

        let userSumX = 0, userSumY = 0, userWeightSum = 0;

        // Process each pixel: Radiometric Thermal Radiation Synthesis (FLIR Microbolometer emulated)
        for (let y = 0; y < th; y++) {
          for (let x = 0; x < tw; x++) {
            const idx = y * tw + x;
            const pIdx = idx * 4;
            const r = pixels[pIdx];
            const g = pixels[pIdx + 1];
            const b = pixels[pIdx + 2];

            // 1. Grayscale luminance & Infrared Radiation Approximation
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            const normLum = lum / 255;

            // 2. Motion Detection (Frame Differencing / Friction Heat)
            const prevLum = prevLumaBuffer[idx];
            const diff = Math.abs(lum - prevLum);
            prevLumaBuffer[idx] = lum;

            if (diff > 6) {
              motionHeatMap[idx] = Math.min(1.0, motionHeatMap[idx] + diff * 0.08);
            } else {
              motionHeatMap[idx] *= 0.88;
            }
            const motionVal = motionHeatMap[idx];

            // 3. Human Spatial Heat Zone (Detected Face/Body OR Localized Center Fallback)
            let humanZoneVal = 0;
            if (hasFace) {
              const dxH = (x - headCx) / headR;
              const dyH = (y - headCy) / headR;
              const distHead = dxH * dxH + dyH * dyH;
              if (distHead < 1.4) {
                humanZoneVal = Math.max(humanZoneVal, 1.0 - distHead / 1.4);
              }

              const dxB = (x - bodyCx) / bodyRx;
              const dyB = (y - bodyCy) / bodyRy;
              const distBody = dxB * dxB + dyB * dyB;
              if (distBody < 1.6) {
                humanZoneVal = Math.max(humanZoneVal, 0.85 - distBody / 1.6);
              }
            } else {
              const dxH = (x - defaultHeadCx) / defaultHeadR;
              const dyH = (y - defaultHeadCy) / defaultHeadR;
              const distHead = dxH * dxH + dyH * dyH;
              if (distHead < 1.3) {
                humanZoneVal = Math.max(humanZoneVal, 0.40 * (1.0 - distHead / 1.3));
              }

              const dxB = (x - defaultBodyCx) / defaultBodyRx;
              const dyB = (y - defaultBodyCy) / defaultBodyRy;
              const distBody = dxB * dxB + dyB * dyB;
              if (distBody < 1.5) {
                humanZoneVal = Math.max(humanZoneVal, 0.30 * (1.0 - distBody / 1.5));
              }
            }

            // 4. Accurate Skin Chrominance Heuristic
            const isSkin = (r > 75 && g > 45 && b > 30 && r > g && g > b && (r - g) > 10 && (r - b) > 15);
            const skinVal = isSkin ? 0.7 : 0;

            // 5. Infrared Radiation Synthesis across ALL objects
            const objectRadiation = normLum * 0.45 + (isSkin ? 0.35 : 0) + humanZoneVal * 0.45 + motionVal * 0.2;
            const activity = Math.min(1.0, objectRadiation);

            // Accumulate weighted human position for real-time tracking fallback
            if (activity > 0.25) {
              userSumX += x * activity;
              userSumY += y * activity;
              userWeightSum += activity;
            }

            // 6. Real Radiometric Thermal Scale Mapping:
            // Cold background objects: 15 ~ 60 (Deep Navy -> Cool Indigo -> Teal)
            const ambientBg = 15 + normLum * 45;
            
            // Human subject & warm objects (face, neck, hands, clothes contours): +40 ~ +80 thermal boost
            const subjectHeat = activity * (40 + normLum * 40);

            // Dynamic Temperature Boost from Speed Slider:
            // Shifts thermal spectrum into Magenta -> Fiery Red -> Blaze Orange -> Yellow -> White-Hot Core
            const speedHeatBoost = activity * (speedHeatFactor * 120);

            let finalThermal = ambientBg + subjectHeat + speedHeatBoost;

            // Sensor micro-noise
            if (activity > 0.1) {
              finalThermal += (Math.random() - 0.5) * 2.5;
            }

            // Clamp to 0 ~ 255
            const lutIdx = Math.max(0, Math.min(255, Math.round(finalThermal)));

            pixels[pIdx] = thermalLUT[lutIdx * 3];
            pixels[pIdx + 1] = thermalLUT[lutIdx * 3 + 1];
            pixels[pIdx + 2] = thermalLUT[lutIdx * 3 + 2];
          }
        }

        if (userWeightSum > 5) {
          detectedUserCenter.x = (userSumX / userWeightSum / tw) * 100;
          detectedUserCenter.y = (userSumY / userWeightSum / th) * 100;
          detectedUserCenter.active = true;
        } else {
          detectedUserCenter.active = false;
        }

        thermalCtx.putImageData(imgData, 0, 0);

      } else {
        // --- Real-Time Procedural Live Simulation Stream (When Camera is OFF) ---
        if (apiActive && apiData) {
          const rawX = typeof apiData.x === 'number' ? apiData.x : 2500;
          const rawY = typeof apiData.y === 'number' ? apiData.y : 2500;

          // Target 2D canvas coordinates
          const targetX = arduinoMap(rawX, 0, 5000, tw * 0.10, tw * 0.90);
          const targetY = arduinoMap(rawY, 0, 5000, th * 0.15, th * 0.85);

          // Calculate time-aware Smoothstep cubic trajectory (3t^2 - 2t^3) across 2000ms polling window
          const elapsedMs = performance.now() - apiLastFetchTime;
          const progressT = Math.max(0, Math.min(1, elapsedMs / 2000));
          const smoothT = progressT * progressT * (3 - 2 * progressT);

          // Organic micro-sway for continuous 60FPS fluid gliding
          const microSwayX = Math.sin(animationTime * 1.5) * 0.8;
          const microSwayY = Math.cos(animationTime * 1.8) * 0.6;

          patrolX = apiStartCanvasX + (targetX - apiStartCanvasX) * smoothT + microSwayX;
          patrolY = apiStartCanvasY + (targetY - apiStartCanvasY) * smoothT + microSwayY;
        } else {
          // Smoothly interpolate user controller steering offset (Fast, responsive 0.40 rate)
          userOffsetX = lerp(userOffsetX, targetUserOffsetX, 0.40);
          userOffsetY = lerp(userOffsetY, targetUserOffsetY, 0.40);

          // Organic free floating base sway & bounce (ONLY active when API is offline and sliders are at center)
          const swayX = Math.sin(animationTime * 1.6) * (tw * 0.22) + Math.cos(animationTime * 0.7) * (tw * 0.1);
          const bounceY = Math.sin(animationTime * 3.2) * 5 + Math.cos(animationTime * 1.1) * 3;

          patrolX = (tw * 0.5 + swayX) + userOffsetX;
          patrolY = (th * 0.40 + bounceY) + userOffsetY;
        }

        // Clamp inside thermal canvas boundary so floating object remains visible
        patrolX = Math.max(tw * 0.10, Math.min(tw * 0.90, patrolX));
        patrolY = Math.max(th * 0.15, Math.min(th * 0.85, patrolY));

        const horizY = th * 0.35;

        // 1. Dark cold space ambient background
        thermalCtx.fillStyle = "rgb(4, 6, 18)";
        thermalCtx.fillRect(0, 0, tw, th);

        // 2. Dynamic 3D scrolling road perspective
        thermalCtx.fillStyle = "rgb(12, 16, 38)";
        thermalCtx.beginPath();
        thermalCtx.moveTo(tw * 0.42, horizY);
        thermalCtx.lineTo(tw * 0.58, horizY);
        thermalCtx.lineTo(tw * 0.95, th);
        thermalCtx.lineTo(tw * 0.05, th);
        thermalCtx.closePath();
        thermalCtx.fill();

        // Moving road markers
        const speedFactor = Math.max(0.2, currentSpeed / 30);
        const roadOffset = (animationTime * 45 * speedFactor) % 30;

        thermalCtx.strokeStyle = "rgb(50, 70, 120)";
        thermalCtx.lineWidth = 1.5;
        for (let d = 0; d < 8; d++) {
          const progress = (d * 12 + roadOffset) / 96;
          if (progress < 0 || progress > 1) continue;
          const ly = horizY + progress * (th - horizY);
          const lx1 = tw * 0.5 - progress * (tw * 0.05);
          const lx2 = tw * 0.5 + progress * (tw * 0.05);
          thermalCtx.beginPath();
          thermalCtx.moveTo(lx1, ly);
          thermalCtx.lineTo(lx2, ly);
          thermalCtx.stroke();
        }

        // 3. Passing roadside thermal structures (Poles & Trees)
        const poleProgress1 = (animationTime * 0.6 * speedFactor) % 1;
        const poleProgress2 = ((animationTime * 0.6 * speedFactor) + 0.5) % 1;

        [poleProgress1, poleProgress2].forEach(prog => {
          const py = horizY + prog * (th - horizY);
          const pw = 4 + prog * 16;
          const ph = 8 + prog * 35;
          const heatLum = Math.round(30 + prog * 100);

          // Left roadside structure
          const pxLeft = (tw * 0.42) - prog * (tw * 0.38) - pw;
          thermalCtx.fillStyle = `rgb(${heatLum}, ${Math.round(heatLum * 0.5)}, ${Math.round(heatLum * 0.8)})`;
          thermalCtx.fillRect(pxLeft, py - ph, pw, ph);

          // Right roadside structure
          const pxRight = (tw * 0.58) + prog * (tw * 0.38);
          thermalCtx.fillStyle = `rgb(${heatLum}, ${Math.round(heatLum * 0.5)}, ${Math.round(heatLum * 0.8)})`;
          thermalCtx.fillRect(pxRight, py - ph, pw, ph);
        });

        // 4. Moving Rider Heat Signature (Head, Torso, Engine & Friction Wheels)
        const effectiveHeatMultiplier = thermalHeatMultiplier + (currentResistance / 100) * 0.4;
        const headRadius = 14 + speedHeatFactor * 8 * effectiveHeatMultiplier;
        const torsoWidth = 28 + speedHeatFactor * 12 * effectiveHeatMultiplier;
        const torsoHeight = 24 + speedHeatFactor * 8 * effectiveHeatMultiplier;

        const baseCold = 45;
        const torsoIntensity = Math.min(255, Math.round(baseCold + speedHeatFactor * 160 * effectiveHeatMultiplier));
        const headIntensity = Math.min(255, Math.round(baseCold + speedHeatFactor * 185 * effectiveHeatMultiplier));
        const faceIntensity = Math.min(255, Math.round(baseCold + speedHeatFactor * 205 * effectiveHeatMultiplier));
        const wheelIntensity = Math.min(255, Math.round(80 + speedHeatFactor * 170 * effectiveHeatMultiplier));

        thermalCtx.filter = "blur(5px)";

        // Wheels & motor friction heat
        const wheelOffset = 18;
        thermalCtx.fillStyle = `rgb(${wheelIntensity}, ${Math.round(wheelIntensity * 0.8)}, ${Math.round(wheelIntensity * 0.4)})`;
        thermalCtx.beginPath();
        thermalCtx.arc(patrolX - wheelOffset, patrolY + 38, 10 + speedHeatFactor * 4, 0, 2 * Math.PI);
        thermalCtx.arc(patrolX + wheelOffset, patrolY + 38, 10 + speedHeatFactor * 4, 0, 2 * Math.PI);
        thermalCtx.fill();

        // Torso
        thermalCtx.fillStyle = `rgb(${torsoIntensity}, ${torsoIntensity}, ${torsoIntensity})`;
        thermalCtx.beginPath();
        thermalCtx.ellipse(patrolX, patrolY + 22, torsoWidth, torsoHeight, 0, 0, 2 * Math.PI);
        thermalCtx.fill();

        // Head
        thermalCtx.fillStyle = `rgb(${headIntensity}, ${headIntensity}, ${headIntensity})`;
        thermalCtx.beginPath();
        thermalCtx.arc(patrolX, patrolY, headRadius, 0, 2 * Math.PI);
        thermalCtx.fill();

        // Face core
        thermalCtx.fillStyle = `rgb(${faceIntensity}, ${faceIntensity}, ${faceIntensity})`;
        thermalCtx.beginPath();
        thermalCtx.ellipse(patrolX, patrolY, headRadius * 0.55, headRadius * 0.7, 0, 0, 2 * Math.PI);
        thermalCtx.fill();

        thermalCtx.filter = "none";

        // Map simulated scene through thermal LUT
        const simImg = thermalCtx.getImageData(0, 0, tw, th);
        const simPixels = simImg.data;
        for (let i = 0; i < simPixels.length; i += 4) {
          const lum = simPixels[i];
          const lutIdx = Math.max(0, Math.min(255, lum));
          simPixels[i] = thermalLUT[lutIdx * 3];
          simPixels[i + 1] = thermalLUT[lutIdx * 3 + 1];
          simPixels[i + 2] = thermalLUT[lutIdx * 3 + 2];
        }
        thermalCtx.putImageData(simImg, 0, 0);
      }

      // Draw high-definition natural camera feed first (photo-friendly, clear face & eyes)
      if (cameraActive && videoFeed.srcObject && videoFeed.readyState === videoFeed.HAVE_ENOUGH_DATA) {
        riderCtx.filter = "contrast(1.08) brightness(1.04) saturate(1.1)";
        riderCtx.imageSmoothingEnabled = true;
        riderCtx.drawImage(videoFeed, 0, 0, w, h);
        riderCtx.filter = "none";

        // Layer glowing Thermal Sci-Fi Ironbow Heatmap on top
        riderCtx.globalCompositeOperation = "screen";
        riderCtx.globalAlpha = 0.55;
        riderCtx.drawImage(thermalCanvas, 0, 0, w, h);
        riderCtx.globalCompositeOperation = "source-over";
        riderCtx.globalAlpha = 1.0;
      } else {
        // Fallback simulated scene when camera is off
        riderCtx.imageSmoothingEnabled = false;
        riderCtx.drawImage(thermalCanvas, 0, 0, w, h);
      }

      // Update dynamic HUD overlays
      updateThermalOverlayTracker();
    } else {
      // Apply filters directly to canvas context with enhanced clarity for human subject
      if (activeFilter === "CINEMATIC") {
        riderCtx.filter = "contrast(1.2) saturate(1.25) brightness(1.05)";
      } else if (activeFilter === "GRAYSCALE") {
        riderCtx.filter = "grayscale(1) contrast(1.3) brightness(1.05)";
      } else {
        riderCtx.filter = "contrast(1.12) brightness(1.05)";
      }

      if (cameraActive && videoFeed.srcObject && videoFeed.readyState === videoFeed.HAVE_ENOUGH_DATA) {
        riderCtx.imageSmoothingEnabled = true;
        riderCtx.drawImage(videoFeed, 0, 0, w, h);
      } else {
        // REAL-TIME PROCEDURAL HUD STREAM (Cinematic / Grayscale / Standard Raw Fallback)
        riderCtx.fillStyle = "#0a0c14";
        riderCtx.fillRect(0, 0, w, h);

        const horizY = h * 0.38;
        const rx = (patrolX / thermalCanvas.width) * w;
        const ry = (patrolY / thermalCanvas.height) * h;

        // Draw 3D road perspective grid lines
        const speedFactor = Math.max(0.2, currentSpeed / 30);
        const gridOffset = (animationTime * 120 * speedFactor) % 40;

        riderCtx.strokeStyle = activeFilter === "CINEMATIC" ? "rgba(0, 229, 255, 0.18)" : (activeFilter === "GRAYSCALE" ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 229, 255, 0.25)");
        riderCtx.lineWidth = 1;

        // Perspective side borders
        riderCtx.beginPath();
        riderCtx.moveTo(w * 0.42, horizY); riderCtx.lineTo(w * 0.02, h);
        riderCtx.moveTo(w * 0.58, horizY); riderCtx.lineTo(w * 0.98, h);
        riderCtx.stroke();

        // Horizontal road grid lines
        for (let yPos = horizY; yPos < h; yPos += 18) {
          const gridY = yPos + (gridOffset * (yPos - horizY) / h);
          if (gridY >= h) continue;
          riderCtx.beginPath();
          riderCtx.moveTo(0, gridY);
          riderCtx.lineTo(w, gridY);
          riderCtx.stroke();
        }

        // Draw real-time moving rider silhouette and HUD reticle
        riderCtx.fillStyle = activeFilter === "CINEMATIC" ? "#00e5ff" : (activeFilter === "GRAYSCALE" ? "#ffffff" : "#00ffcc");
        riderCtx.shadowColor = riderCtx.fillStyle;
        riderCtx.shadowBlur = 10;

        // Vehicle / rider marker
        riderCtx.beginPath();
        riderCtx.arc(rx, ry + 15, 12, 0, 2 * Math.PI);
        riderCtx.fill();

        // Rider head
        riderCtx.beginPath();
        riderCtx.arc(rx, ry - 10, 8, 0, 2 * Math.PI);
        riderCtx.fill();
        riderCtx.shadowBlur = 0;

        // Speed motion particles streaming past
        riderCtx.strokeStyle = activeFilter === "CINEMATIC" ? "rgba(255, 45, 85, 0.6)" : "rgba(255, 255, 255, 0.4)";
        for (let p = 0; p < 6; p++) {
          const pProgress = ((animationTime * 2.5 * speedFactor) + p * 0.16) % 1;
          const px = (w * 0.1) + p * (w * 0.16);
          const py = horizY + pProgress * (h - horizY);
          riderCtx.beginPath();
          riderCtx.moveTo(px, py);
          riderCtx.lineTo(px, py + 12 * speedFactor);
          riderCtx.stroke();
        }
      }
    }
  }

  function updateThermalOverlayTracker() {
    if (activeFilter !== "THERMAL") return;
    
    // 1. Organic Automatic Temperature & Size Pulsing (Breathes continuously even without manual control)
    const autoHeatPulse = 0.5 + 0.38 * Math.sin(animationTime * 1.4) + 0.12 * Math.cos(animationTime * 2.8);
    const speedHeatFactor = Math.pow(controllerHeatFactor, 0.75);
    const totalHeatFactor = Math.max(0, Math.min(1, autoHeatPulse * 0.75 + speedHeatFactor * 0.25));

    const baseTemp = 30.0;
    const maxCeiling = (maxScaleTemp && !isNaN(maxScaleTemp)) ? maxScaleTemp : 80;
    const dynamicRange = maxCeiling - baseTemp;

    const fluctuation = Math.sin(animationTime * 3.2) * 0.7;
    const noise = (Math.random() - 0.5) * 0.3;
    let currentTemp = baseTemp + (totalHeatFactor * dynamicRange) + fluctuation + noise;
    currentTemp = Math.max(26.0, Math.min(maxCeiling + 2, currentTemp));
    
    if (thermalTempVal) {
      thermalTempVal.textContent = currentTemp.toFixed(1);
    }
    
    // Update coordinate HUD text elements
    if (thermalXVal) {
      thermalXVal.textContent = `x-${Math.round(gpsCoords.x)}`;
    }
    if (thermalYVal) {
      thermalYVal.textContent = `y-${Math.round(gpsCoords.y)}`;
    }

    // 2. Position tracking coordinates (using actual webcam face detection or fallback real-time simulation)
    let targetBoxX, targetBoxY;
    if (cameraActive && smoothFace.active && smoothFace.width > 0) {
      const vw = videoFeed.videoWidth || videoFeed.clientWidth || 1280;
      const vh = videoFeed.videoHeight || videoFeed.clientHeight || 720;
      const cx = smoothFace.x + smoothFace.width / 2;
      const cy = smoothFace.y + smoothFace.height / 2;
      
      // Convert pixel center coordinates to percentages of video size
      targetBoxX = (cx / vw) * 100;
      targetBoxY = (cy / vh) * 100;
    } else if (cameraActive && detectedUserCenter.active) {
      // Use real-time skin/motion center of mass
      targetBoxX = detectedUserCenter.x;
      targetBoxY = detectedUserCenter.y;
    } else {
      // Real-time tracking of the simulated moving subject!
      targetBoxX = (patrolX / thermalCanvas.width) * 100;
      targetBoxY = (patrolY / thermalCanvas.height) * 100;
    }
    
    // 100% position lock: Neon HUD continuously locks onto moving infographic position
    currentBoxX = targetBoxX;
    currentBoxY = targetBoxY;

    // FLIR Thermal Color Spectrum Mapper
    function getThermalThemeColor(temp) {
      if (temp < 36.0) return "#00e5ff";      // Cool Cyan / Indigo Blue
      if (temp < 48.0) return "#30d158";      // Emerald Green
      if (temp < 60.0) return "#ff9f0a";      // Blaze Orange
      if (temp < 72.0) return "#ff3b30";      // Fiery Crimson Red
      return "#ffcc00";                       // White-Hot Core Yellow
    }

    const dynamicThemeColor = getThermalThemeColor(currentTemp);

    if (thermalFaceBox) {
      thermalFaceBox.style.left = `${currentBoxX}%`;
      thermalFaceBox.style.top = `${currentBoxY}%`;
      
      // Keep Neon HUD reticle perfectly upright without rotation
      thermalFaceBox.style.transform = `translate(-50%, -50%)`;
      
      // Dynamic Size Scaling: Organic Automatic Breathing Pulse + Temperature & Depth (85px ~ 175px)
      const sizePulse = Math.sin(animationTime * 1.8) * 18;
      const tempRatio = Math.max(0, Math.min(1, (currentTemp - 26) / 54));
      const depthYRatio = (currentBoxY / 100);
      const dynamicReticleSize = Math.round(85 + tempRatio * 45 + depthYRatio * 25 + sizePulse);
      
      thermalFaceBox.style.width = `${dynamicReticleSize}px`;
      thermalFaceBox.style.height = `${dynamicReticleSize}px`;
      thermalFaceBox.style.borderColor = dynamicThemeColor;
      thermalFaceBox.style.boxShadow = `0 0 18px ${dynamicThemeColor}, inset 0 0 12px ${dynamicThemeColor}`;

      // Dynamic Color applied to corner reticle brackets
      const brackets = thermalFaceBox.querySelectorAll('.target-bracket');
      brackets.forEach(b => {
        b.style.borderColor = dynamicThemeColor;
        b.style.filter = `drop-shadow(0 0 8px ${dynamicThemeColor})`;
      });

      // Dynamic Color applied to Temperature Readout text
      if (thermalTempVal) {
        thermalTempVal.style.color = dynamicThemeColor;
        thermalTempVal.style.textShadow = `0 0 10px ${dynamicThemeColor}`;
      }
    }

    // Dynamic Scale Indicator follows the speed-mapped temperature if not being dragged
    if (scaleIndicator && !isDraggingScale) {
      const tempNormalized = Math.max(0, Math.min(1, (currentTemp - 26) / 54));
      const topPct = (1 - tempNormalized) * 100;
      scaleIndicator.style.top = `${topPct}%`;
    }

    // 3. Update Calibration load bar
    if (calCorrelationBar) {
      calCorrelationBar.style.width = `${Math.round(speedHeatFactor * 100)}%`;
    }

    // 4. Keep date up-to-date
    if (thermalMetaDate) {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const formattedDate = `${pad(now.getMonth() + 1)}/${pad(now.getDate())}/${String(now.getFullYear()).slice(-2)}`;
      thermalMetaDate.textContent = formattedDate;
    }
  }

  function initGallery() {
    const galleryScrollPanel = document.getElementById("gallery-scroll-panel");
    if (!galleryScrollPanel) return;

    galleryScrollPanel.innerHTML = ""; // clear empty state

    // Create placeholder canvas
    const placeholderCanvas = document.createElement("canvas");
    placeholderCanvas.width = 320;
    placeholderCanvas.height = 180;
    const pCtx = placeholderCanvas.getContext("2d");
    pCtx.fillStyle = "#05060f";
    pCtx.fillRect(0, 0, 320, 180);
    pCtx.strokeStyle = "rgba(0, 229, 255, 0.08)";
    pCtx.lineWidth = 1;
    // Draw crosshair lines
    pCtx.beginPath();
    pCtx.moveTo(160, 0); pCtx.lineTo(160, 180);
    pCtx.moveTo(0, 90); pCtx.lineTo(320, 90);
    pCtx.stroke();
    // Subtle circle in center
    pCtx.beginPath();
    pCtx.arc(160, 90, 30, 0, 2 * Math.PI);
    pCtx.stroke();
    const placeholderDataUrl = placeholderCanvas.toDataURL();

    for (let i = 0; i < 3; i++) {
      const card = document.createElement("div");
      card.className = "gallery-card";
      card.id = `gallery-card-${i}`;
      
      const img = document.createElement("img");
      img.src = placeholderDataUrl;
      img.alt = `CAM-01 STANDBY`;
      
      const overlay = document.createElement("div");
      overlay.className = "gallery-card-overlay";
      
      const topRow = document.createElement("div");
      topRow.className = "gallery-card-top";
      topRow.innerHTML = `<span>CAM-01</span><span class="gallery-card-frame">#-----</span>`;
      
      const bottomRow = document.createElement("div");
      bottomRow.className = "gallery-card-bottom";
      bottomRow.innerHTML = `<span>--:--:--</span><span style="color: rgba(255, 255, 255, 0.35);">STANDBY</span>`;
      
      overlay.appendChild(topRow);
      overlay.appendChild(bottomRow);
      
      card.appendChild(img);
      card.appendChild(overlay);
      
      galleryScrollPanel.appendChild(card);
      galleryCards.push(card);
    }
  }

  function startSnapshotTimer() {
    if (snapshotIntervalId) clearInterval(snapshotIntervalId);
    
    // Trigger first capture 300ms after load so the gallery isn't empty initially
    setTimeout(() => {
      triggerRiderCapture();
    }, 300);

    snapshotIntervalId = setInterval(() => {
      triggerRiderCapture();
    }, 1000);
  }

  function triggerRiderCapture() {
    // System always captures — regardless of camera state. The machine does not stop.
    
    // 1. Shutter Flash on main screen
    snapFlash.classList.remove("flash-trigger");
    void snapFlash.offsetWidth;
    snapFlash.classList.add("flash-trigger");
    if (cameraActive) {
      playHapticTap(1600, 0.05, 0.015);
    }

    // 2. Increment capture count
    captureCount++;
    const captureCounter = document.getElementById("capture-counter");
    if (captureCounter) captureCounter.textContent = String(captureCount).padStart(5, '0');
    const galleryCounter = document.getElementById("gallery-counter");
    if (galleryCounter) galleryCounter.textContent = String(captureCount).padStart(5, '0');
    
    // Update main VHS screen CAP counter
    const vhsCapCounter = document.getElementById("vhs-cap-counter");
    if (vhsCapCounter) vhsCapCounter.textContent = String(captureCount).padStart(5, '0');
    
    const now = new Date();
    const timeStamp = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    const frameLabel = `#${String(captureCount).padStart(5,'0')}`;

    // 3. Update circular gallery card (loop format) with auto memory garbage collection
    const galleryScrollPanel = document.getElementById("gallery-scroll-panel");
    if (galleryScrollPanel && galleryCards.length === 3) {
      riderCanvas.toBlob((blob) => {
        if (!blob) return;
        const card = galleryCards[currentGalleryIndex];
        
        // Update image with memory release
        const img = card.querySelector("img");
        if (img) {
          if (img.dataset.blobUrl) {
            URL.revokeObjectURL(img.dataset.blobUrl);
          }
          const newUrl = URL.createObjectURL(blob);
          img.dataset.blobUrl = newUrl;
          img.src = newUrl;
          img.alt = `Capture ${frameLabel}`;
        }
        
        // Update text
        const topRow = card.querySelector(".gallery-card-top");
        if (topRow) {
          topRow.innerHTML = `<span>CAM-01</span><span class="gallery-card-frame">${frameLabel}</span>`;
        }
        
        const bottomRow = card.querySelector(".gallery-card-bottom");
        if (bottomRow) {
          bottomRow.innerHTML = `<span>${timeStamp}</span><span style="color: #00e5ff;">CAPTURED</span>`;
        }
        
        // Trigger card update animation
        card.classList.remove("just-updated");
        void card.offsetWidth; // trigger reflow
        card.classList.add("just-updated");
        
        // Increment index circularly
        currentGalleryIndex = (currentGalleryIndex + 1) % 3;
      }, "image/jpeg", 0.5);
    }
  }

  // --- 4. Mini Telemetry Trend Chart ---
  function setupChartCanvas() {
    if (!chartCanvas) return;
    resizeChartCanvas();
    window.addEventListener("resize", resizeChartCanvas);
  }

  function resizeChartCanvas() {
    if (!chartCanvas) return;
    const parent = chartCanvas.parentElement;
    if (parent) {
      chartCanvas.width = parent.clientWidth;
      chartCanvas.height = parent.clientHeight;
    }
  }

  function drawTelemetryChart() {
    if (!chartCanvas || !chartCtx) return;
    const w = chartCanvas.width;
    const h = chartCanvas.height;
    
    chartCtx.clearRect(0, 0, w, h);
    
    // Draw single clean trend wave
    chartCtx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    chartCtx.lineWidth = 1;
    chartCtx.beginPath();
    
    const step = w / (speedHistory.length - 1);
    for (let i = 0; i < speedHistory.length; i++) {
      const norm = speedHistory[i] / 150;
      const x = i * step;
      const y = h - (norm * (h - 6)) - 3;
      
      if (i === 0) chartCtx.moveTo(x, y);
      else chartCtx.lineTo(x, y);
    }
    chartCtx.stroke();
  }

  function addEventLog(msg) {
    // Left console log for debugging in terminal, but since UI console is removed, we print to standard console.
    console.log(`[RADUGA] ${msg}`);
  }

  // --- Main Animation Loop ---
  let monitorFrameCounter = 0;
  function drawMonitorCells() {
    monitorFrameCounter++;
    if (monitorFrameCounter % 2 !== 0) return; // Throttle 6 sub-canvases to 30 FPS to save 50% GPU/CPU overhead
    for (let i = 0; i < monitorCtxs.length; i++) {
      const mc = monitorCanvases[i];
      const ctx = monitorCtxs[i];
      // Ensure canvas pixel dimensions match element size
      if (mc.width !== mc.clientWidth || mc.height !== mc.clientHeight) {
        mc.width = mc.clientWidth || 200;
        mc.height = mc.clientHeight || 112;
      }
      if (mc.width > 0 && mc.height > 0) {
        ctx.drawImage(riderCanvas, 0, 0, mc.width, mc.height);
      }
    }
  }

  // --- Camera Viewfinder Animations ---
  let timecodeFrames = 0;
  let audioMeterTime = 0;
  let lastMeterUpdate = 0;
  
  // Cache viewfinder level elements (from bottom to top)
  const lBar = document.querySelectorAll(".vf-level-bar.L .vf-level-segment");
  const rBar = document.querySelectorAll(".vf-level-bar.R .vf-level-segment");
  const lSegments = Array.from(lBar).reverse();
  const rSegments = Array.from(rBar).reverse();

  function updateTimecode() {
    timecodeFrames++;
    const fps = 60;
    const totalSecs = Math.floor(timecodeFrames / fps);
    const frames = timecodeFrames % fps;
    const secs = totalSecs % 60;
    const mins = Math.floor(totalSecs / 60) % 60;
    const hrs = Math.floor(totalSecs / 3600) % 24;
    
    const pad = (n) => String(n).padStart(2, '0');
    const timecodeEl = document.getElementById("vf-timecode");
    if (timecodeEl) {
      timecodeEl.textContent = `${pad(hrs)}:${pad(mins)}:${pad(secs)}:${pad(frames)}`;
    }
  }

  function updateLevelMeters() {
    audioMeterTime += 0.1;
    if (lSegments.length === 0 || rSegments.length === 0) return;
    
    // Generate organic-looking level peaks
    let baseL = 7 + Math.sin(audioMeterTime * 0.8) * 3 + Math.cos(audioMeterTime * 1.5) * 2;
    let baseR = 7 + Math.cos(audioMeterTime * 0.7) * 3 + Math.sin(audioMeterTime * 1.2) * 2;
    
    // Add random noise
    baseL += (Math.random() - 0.5) * 3.5;
    baseR += (Math.random() - 0.5) * 3.5;
    
    const peakL = Math.max(0, Math.min(14, Math.round(baseL)));
    const peakR = Math.max(0, Math.min(14, Math.round(baseR)));
    
    for (let i = 0; i < 15; i++) {
      if (i <= peakL) {
        lSegments[i].classList.add("active");
      } else {
        lSegments[i].classList.remove("active");
      }
      
      if (i <= peakR) {
        rSegments[i].classList.add("active");
      } else {
        rSegments[i].classList.remove("active");
      }
    }
  }

  function updateVhsClockDate() {
    const now = new Date();
    
    // Format Time: e.g. "PM 06:53"
    let hours = now.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const mins = String(now.getMinutes()).padStart(2, '0');
    const clockText = `${ampm} ${String(hours).padStart(2, '0')}:${mins}`;
    
    // Format Date: e.g. "May 05.1995"
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = months[now.getMonth()];
    const day = String(now.getDate()).padStart(2, '0');
    const year = now.getFullYear();
    const dateText = `${month} ${day}.${year}`;
    
    const clockEl = document.getElementById("vhs-clock");
    const dateEl = document.getElementById("vhs-date");
    if (clockEl) clockEl.textContent = clockText;
    if (dateEl) dateEl.textContent = dateText;
  }

  // Initialize VCR Clock/Date loops
  updateVhsClockDate();
  setInterval(updateVhsClockDate, 1000);

  let saveUpdateFrame = 0;
  
  // Define 3D ship wireframe points matching the Pinterest vector layout
  const spaceshipVertices = [
    {x: 0, y: 0, z: 25},    // Nose tip (0)
    {x: -15, y: -4, z: -5},  // Wing left tip outer (1)
    {x: -12, y: -2, z: -5},  // Wing left tip inner (2)
    {x: 15, y: -4, z: -5},   // Wing right tip outer (3)
    {x: 12, y: -2, z: -5},   // Wing right tip inner (4)
    {x: 0, y: 5, z: -15},    // Thruster center bottom (5)
    {x: 0, y: -5, z: -15},   // Thruster center top (6)
    {x: -6, y: 0, z: 5},     // Mid cockpit left (7)
    {x: 6, y: 0, z: 5},      // Mid cockpit right (8)
    {x: 0, y: -8, z: -5}     // Fin top (9)
  ];

  const spaceshipEdges = [
    [0, 7], [0, 8], [7, 8],      // Cockpit nose structure
    [7, 1], [1, 2], [2, 5],      // Left wing outer loop
    [8, 3], [3, 4], [4, 5],      // Right wing outer loop
    [7, 6], [8, 6], [5, 6],      // Rear fuselage bounds
    [0, 9], [9, 6],              // Upper fin ridge
    [1, 6], [3, 6],              // Engine structural supports
    [2, 7], [4, 8]               // Inner wing braces
  ];

  function updateSavingDashboard() {
    saveUpdateFrame++;
    
    // Update Resistance Gauge UI
    if (resistanceVal) resistanceVal.textContent = currentResistance;
    if (resistanceBarFill) {
      resistanceBarFill.style.width = `${currentResistance}%`;
      const hue = 180 + (currentResistance / 100) * 180;
      resistanceBarFill.style.backgroundColor = `hsl(${hue}, 100%, 50%)`;
      resistanceBarFill.style.boxShadow = `0 0 8px hsl(${hue}, 100%, 50%)`;
    }
    
    // Dynamic coupling connection to Thermal Integration Panel
    const thermalCalBanner = document.querySelector(".speed-slider-below .thermal-cal-banner");
    if (thermalCalBanner) {
      // Glow and pulse scale matching resistance level
      const glowIntensity = (currentResistance / 100) * 8;
      thermalCalBanner.style.boxShadow = `inset 0 0 ${2 + glowIntensity}px rgba(255, 59, 48, ${0.15 + (currentResistance / 150)}), 0 0 ${glowIntensity}px rgba(255, 59, 48, ${currentResistance / 150})`;
      if (currentResistance > 60) {
        thermalCalBanner.style.transform = `scale(${1 + (currentResistance - 60) / 1200})`;
        thermalCalBanner.style.backgroundColor = `rgba(255, 59, 48, ${(currentResistance - 60) / 1500})`;
      } else {
        thermalCalBanner.style.transform = "none";
        thermalCalBanner.style.backgroundColor = "transparent";
      }
    }
    if (calFactorVal) {
      const shadowGlow = (currentResistance / 100) * 6;
      calFactorVal.style.textShadow = `0 0 ${shadowGlow}px rgba(255, 59, 48, 0.8)`;
    }
    
    // Fluctuate properties progress bars slightly to show active saving state
    if (saveUpdateFrame % 8 === 0) {
      const targets = [81, 97, 92, 79, 77];
      for (let i = 0; i < 5; i++) {
        const pctEl = document.getElementById(`prop-pct-${i}`);
        const barEl = document.getElementById(`prop-bar-${i}`);
        if (pctEl && barEl) {
          const val = targets[i] + Math.round((Math.random() - 0.5) * 2);
          pctEl.textContent = `[${val}%]`;
          barEl.style.width = `${val}%`;
        }
      }
    }

    // Render the 3D Hologram Mesh Animation
    const holoCanvas = document.getElementById("hologram-mesh-canvas");
    if (holoCanvas) {
      const hCtx = holoCanvas.getContext("2d");
      const w = holoCanvas.width;
      const h = holoCanvas.height;
      
      hCtx.clearRect(0, 0, w, h);
      
      // Draw grid ticks in background of panel
      hCtx.strokeStyle = "rgba(0, 229, 255, 0.08)";
      hCtx.lineWidth = 1;
      const tickStep = 15;
      hCtx.beginPath();
      for (let x = 0; x < w; x += tickStep) {
        hCtx.moveTo(x, 0); hCtx.lineTo(x, h);
      }
      for (let y = 0; y < h; y += tickStep) {
        hCtx.moveTo(0, y); hCtx.lineTo(w, y);
      }
      hCtx.stroke();

      // Rotation angles based on timer
      const angleY = animationTime * 0.95; // Side rotation
      const angleX = -0.3 + Math.sin(animationTime * 0.45) * 0.2; // Pitch fluctuation
      
      // Projection helper
      const projected = [];
      const scale = 1.35 + Math.sin(animationTime * 1.5) * 0.08; // Slight breathing animation
      
      spaceshipVertices.forEach(v => {
        // Rotate Y (Yaw)
        let x1 = v.x * Math.cos(angleY) - v.z * Math.sin(angleY);
        let z1 = v.x * Math.sin(angleY) + v.z * Math.cos(angleY);
        
        // Rotate X (Pitch)
        let y2 = v.y * Math.cos(angleX) - z1 * Math.sin(angleX);
        let z2 = v.y * Math.sin(angleX) + z1 * Math.cos(angleX);
        
        // Perspective projection parameters
        const dist = 75;
        const projScale = dist / (dist + z2) * scale * 1.8;
        
        // Scale to canvas center
        const screenX = w / 2 + x1 * projScale;
        const screenY = h / 2 + y2 * projScale;
        projected.push({x: screenX, y: screenY});
      });

      // Draw wireframe edges
      hCtx.strokeStyle = "#ff3b30"; // Deep red lines matching the spaceship structure
      hCtx.shadowColor = "#ff3b30";
      hCtx.shadowBlur = 4;
      hCtx.lineWidth = 1.2;
      hCtx.beginPath();
      spaceshipEdges.forEach(edge => {
        const p1 = projected[edge[0]];
        const p2 = projected[edge[1]];
        hCtx.moveTo(p1.x, p1.y);
        hCtx.lineTo(p2.x, p2.y);
      });
      hCtx.stroke();
      hCtx.shadowBlur = 0; // Reset shadow

      // Draw glowing node vertices
      hCtx.fillStyle = "#00e5ff"; // Cyan coordinate nodes
      projected.forEach(p => {
        hCtx.beginPath();
        hCtx.arc(p.x, p.y, 2, 0, 2 * Math.PI);
        hCtx.fill();
      });
    }
  }

  // --- Mini Joystick Resistance Trend Chart ---
  function drawResistanceChart() {
    if (!resistanceChartCanvas || !resistanceChartCtx) return;
    
    const w = resistanceChartCanvas.clientWidth;
    const h = resistanceChartCanvas.clientHeight;
    
    if (resistanceChartCanvas.width !== w || resistanceChartCanvas.height !== h) {
      resistanceChartCanvas.width = w;
      resistanceChartCanvas.height = h;
    }
    
    resistanceChartCtx.clearRect(0, 0, w, h);
    
    if (resistanceHistory.length < 2) return;
    
    resistanceChartCtx.lineWidth = 1.5;
    
    // Create gradient based on average resistance for line glow look
    const grad = resistanceChartCtx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "rgba(0, 229, 255, 0.4)");
    grad.addColorStop(0.5, "rgba(0, 229, 255, 0.9)");
    grad.addColorStop(1, "rgba(0, 229, 255, 0.4)");
    
    resistanceChartCtx.strokeStyle = grad;
    resistanceChartCtx.beginPath();
    
    const step = w / (resistanceHistory.length - 1);
    for (let i = 0; i < resistanceHistory.length; i++) {
      const norm = resistanceHistory[i] / 100;
      const x = i * step;
      const y = h - (norm * (h - 4)) - 2;
      
      if (i === 0) resistanceChartCtx.moveTo(x, y);
      else resistanceChartCtx.lineTo(x, y);
    }
    resistanceChartCtx.stroke();
    
    // Fill the bottom area
    resistanceChartCtx.lineTo(w, h);
    resistanceChartCtx.lineTo(0, h);
    resistanceChartCtx.closePath();
    resistanceChartCtx.fillStyle = "rgba(0, 229, 255, 0.05)";
    resistanceChartCtx.fill();
  }

  // Setup Tooltip Interaction
  if (resistanceChartContainer && terrainTooltip) {
    resistanceChartContainer.addEventListener("mousemove", (e) => {
      terrainTooltip.style.display = "block";
      
      const tooltipWidth = 180;
      const tooltipHeight = 110;
      
      let left = e.clientX + 15;
      let top = e.clientY + 15;
      
      // Prevent overflow
      if (left + tooltipWidth > window.innerWidth) {
        left = e.clientX - tooltipWidth - 15;
      }
      if (top + tooltipHeight > window.innerHeight) {
        top = e.clientY - tooltipHeight - 15;
      }
      
      terrainTooltip.style.left = `${left}px`;
      terrainTooltip.style.top = `${top}px`;
    });
    
    resistanceChartContainer.addEventListener("mouseleave", () => {
      terrainTooltip.style.display = "none";
    });
  }

  // Setup Thermal Calibration Slider Interaction
  if (thermalFactorSlider) {
    thermalFactorSlider.addEventListener("input", (e) => {
      thermalHeatMultiplier = parseFloat(e.target.value);
      if (calFactorVal) {
        calFactorVal.textContent = `속도 민감도: ${thermalHeatMultiplier.toFixed(1)}x`;
      }
      playHapticTap(900 + thermalHeatMultiplier * 100, 0.015, 0.01);
    });
  }

  // Setup Dynamic Scale Ticks and Drag Interaction
  function updateScaleTicks() {
    const currentCeiling = (maxScaleTemp && !isNaN(maxScaleTemp)) ? maxScaleTemp : 80;
    if (tick0) tick0.textContent = parseFloat(currentCeiling).toFixed(1);
    if (tick1) tick1.textContent = parseFloat(currentCeiling * 0.75).toFixed(1);
    if (tick2) tick2.textContent = parseFloat(currentCeiling * 0.50).toFixed(1);
    if (tick3) tick3.textContent = parseFloat(currentCeiling * 0.25).toFixed(1);
    if (tick4) tick4.textContent = "0.0";
  }

  let isDraggingScale = false;
  
  function handleScaleChange(clientY) {
    if (!scaleBarWrapper || !scaleIndicator) return;
    const rect = scaleBarWrapper.getBoundingClientRect();
    let y = clientY - rect.top;
    y = Math.max(0, Math.min(rect.height, y));
    
    const pct = 1 - (y / rect.height); // 0.0 at bottom, 1.0 at top
    maxScaleTemp = Math.round(40 + pct * 80); // range 40 ~ 120
    
    scaleIndicator.style.top = `${(1 - pct) * 100}%`;
    updateScaleTicks();
    
    if (Math.round(maxScaleTemp) % 2 === 0) {
      playHapticTap(1000 + maxScaleTemp * 3, 0.012, 0.008);
    }
  }
  
  if (scaleBarWrapper) {
    scaleBarWrapper.addEventListener("mousedown", (e) => {
      isDraggingScale = true;
      handleScaleChange(e.clientY);
      e.preventDefault();
    });
    
    window.addEventListener("mousemove", (e) => {
      if (isDraggingScale) {
        handleScaleChange(e.clientY);
      }
    });
    
    window.addEventListener("mouseup", () => {
      isDraggingScale = false;
    });
    
    // Touch support
    scaleBarWrapper.addEventListener("touchstart", (e) => {
      isDraggingScale = true;
      handleScaleChange(e.touches[0].clientY);
      e.preventDefault();
    });
    
    window.addEventListener("touchmove", (e) => {
      if (isDraggingScale) {
        handleScaleChange(e.touches[0].clientY);
      }
    });
    
    window.addEventListener("touchend", () => {
      isDraggingScale = false;
    });
    
    // Initial ticks update
    updateScaleTicks();
    // Position indicator initially at 50% (matching the 80°C out of 40-120 range)
    const initialPct = (maxScaleTemp - 40) / 80;
    scaleIndicator.style.top = `${(1 - initialPct) * 100}%`;
  }

  // --- Telemetry Sharing Sender ---
  let lastTelemetrySendTime = 0;
  function sendTelemetry() {
    const now = performance.now();
    if (now - lastTelemetrySendTime > 100) {
      lastTelemetrySendTime = now;
      const msg = {
        type: 'telemetry',
        speed: currentSpeed,
        rotation: Math.max(-90, Math.min(90, (gpsCoords.heading - 184.2) * 5)),
        cameraActive: cameraActive
      };
      if (cameraChannel) {
        cameraChannel.postMessage(msg);
      }
      childWindows = childWindows.filter(win => {
        try {
          if (win.closed) return false;
          win.postMessage(msg, '*');
          return true;
        } catch (e) {
          return false;
        }
      });
    }
  }


  function mainRenderLoop(timestamp) {
    simulateTelemetry();
    processWebcamFeed();
    sendTelemetry(); // Send telemetry to sharing channels
    drawTelemetryChart();
    drawResistanceChart();
    
    // Viewfinder animations
    updateTimecode();
    
    // Holographic saving stats updates
    updateSavingDashboard();
    
    // Throttle level meter updates to ~20 FPS for natural movement
    if (!lastMeterUpdate || timestamp - lastMeterUpdate > 50) {
      updateLevelMeters();
      lastMeterUpdate = timestamp;
    }
    
    mainLoopId = requestAnimationFrame(mainRenderLoop);
  }

  // --- Initialization ---
  initFaceTracker();
  setupWebcamCanvas();
  initGallery();
  updateFilterUI();
  setupChartCanvas();
  startClock();
  updateSpeedGauge(currentSpeed);
  pollPositionAPI();
  
  // Start Main Loop & Timers
  mainLoopId = requestAnimationFrame(mainRenderLoop);
  startSnapshotTimer();

  // --- Camera Integration Status: Explicitly Unlinked ---
  stopWebcam();
  console.log("[Raduga Telemetry] Camera integration unlinked. Operating in procedural simulation mode.");
  const cameraStatusBadge = document.getElementById("camera-status-badge");
  if (cameraStatusBadge) {
    cameraStatusBadge.textContent = "CAM UNLINKED";
    cameraStatusBadge.style.background = "rgba(255, 69, 58, 0.12)";
    cameraStatusBadge.style.color = "#ff453a";
    cameraStatusBadge.style.borderColor = "rgba(255, 69, 58, 0.3)";
  }
});
