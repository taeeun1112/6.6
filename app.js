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
  const chartCtx = chartCanvas.getContext("2d");

  // --- State Variables ---
  let currentSpeed = 45; // km/h
  let targetSpeed = 45; // for smooth easing
  let autoDriveActive = false;
  let cameraActive = false;
  let activeFilter = "THERMAL"; // THERMAL, CINEMATIC, GRAYSCALE, STANDARD

  // Offscreen canvas for thermal pixel processing (320x180 for retro pixelation + high performance)
  const thermalCanvas = document.createElement("canvas");
  thermalCanvas.width = 320;
  thermalCanvas.height = 180;
  const thermalCtx = thermalCanvas.getContext("2d");

  // Thermal Color Lookup Table (LUT)
  const thermalLUT = new Uint8ClampedArray(256 * 3);
  function initThermalLUT() {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    const grad = ctx.createLinearGradient(0, 0, 256, 0);
    // Thermal colors matching user reference image
    grad.addColorStop(0.0, "rgb(5, 5, 26)");       // Deep background blue/black
    grad.addColorStop(0.12, "rgb(0, 0, 180)");     // Cold Blue
    grad.addColorStop(0.25, "rgb(0, 180, 255)");   // Cyan
    grad.addColorStop(0.4, "rgb(0, 220, 0)");      // Green
    grad.addColorStop(0.58, "rgb(230, 230, 0)");   // Yellow
    grad.addColorStop(0.72, "rgb(255, 100, 0)");   // Orange
    grad.addColorStop(0.85, "rgb(240, 0, 120)");   // Magenta / Hot Pink
    grad.addColorStop(0.96, "rgb(255, 100, 180)"); // Near white pink
    grad.addColorStop(1.0, "rgb(255, 255, 255)");  // White Hot
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

  // --- Face Tracker Initialization ---
  function initFaceTracker() {
    if (typeof tracking !== "undefined") {
      faceTracker = new tracking.ObjectTracker("face");
      faceTracker.setInitialScale(4);
      faceTracker.setStepSize(2);
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
        } else {
          lastDetectedFace = null;
        }
      });
    }
  }

  // --- Initialization ---
  initFaceTracker();
  setupWebcamCanvas();
  updateFilterUI();
  setupChartCanvas();
  startClock();
  updateSpeedGauge(currentSpeed);
  
  // Start Main Loop & Timers
  mainLoopId = requestAnimationFrame(mainRenderLoop);
  startSnapshotTimer();

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

  // --- 2. Telemetry and Speed logic ---
  function updateSpeedGauge(val) {
    currentSpeed = val;
    hudSpeedVal.textContent = Math.round(currentSpeed);
    sliderSpeedVal.textContent = `${Math.round(currentSpeed)} KM/H`;
    speedSlider.value = Math.round(currentSpeed);
    
    // speed scale calculation
    const factor = (currentSpeed / 45).toFixed(1);
    const vFactorLbl = document.getElementById('v-factor-lbl');
    if (vFactorLbl) vFactorLbl.textContent = `V_FACTOR: ${factor}x`;
  }

  // Linear Interpolation for smooth velocity changes
  function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
  }

  speedSlider.addEventListener("input", (e) => {
    if (autoDriveActive) {
      autoDriveActive = false;
      btnAutoPilot.classList.remove("active");
    }
    targetSpeed = parseFloat(e.target.value);
    
    // Play light scroll clicking sound
    if (Math.round(e.target.value) % 8 === 0) {
      playHapticTap(1000 + parseFloat(e.target.value) * 3, 0.015, 0.01);
    }
  });

  function simulateTelemetry() {
    animationTime += 0.01;
    
    if (autoDriveActive) {
      let baseSpeed = 55;
      targetSpeed = baseSpeed 
        + Math.sin(animationTime * 0.4) * 22 
        + Math.cos(animationTime * 1.5) * 6;
      targetSpeed = Math.max(0, Math.min(145, targetSpeed));
    }

    // Apply smooth interpolation to current speed (increased to 0.3 for snappy feedback)
    const easedSpeed = lerp(currentSpeed, targetSpeed, 0.3);
    updateSpeedGauge(easedSpeed);

    // Save history
    speedHistory.push(currentSpeed);
    speedHistory.shift();

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
    coordsLatLng.textContent = `${gpsCoords.lat.toFixed(5)}° N / ${gpsCoords.lng.toFixed(5)}° E`;
    coordsHead.textContent = `${gpsCoords.heading.toFixed(1)}° (${getCompassDirection(gpsCoords.heading)})`;
  }

  function getCompassDirection(deg) {
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const idx = Math.round(deg / 45) % 8;
    return dirs[idx];
  }

  // --- 3. Camera Controls & Captures ---
  function setupWebcamCanvas() {
    riderCanvas.width = 1280;
    riderCanvas.height = 720;
  }

  btnCameraPower.addEventListener("click", () => {
    playHapticTap(1200, 0.04, 0.02);
    if (!cameraActive) {
      // Turn Camera ON
      navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
        .then((stream) => {
          videoFeed.srcObject = stream;
          cameraActive = true;
          btnCameraPower.textContent = "Stop Camera";
          btnCameraPower.classList.add("active");
          gpsStatusBadge.textContent = "GPS LOCKED & STREAMING";
          gpsStatusBadge.classList.add("active");
          
          // Start face tracking
          if (faceTracker && !trackerTask) {
            trackerTask = tracking.track('#webcam-feed', faceTracker);
          }
        })
        .catch(() => {
          // Fallback activated silently
          cameraActive = false;
          btnCameraPower.textContent = "Stop Fallback";
          btnCameraPower.classList.add("active");
          cameraActive = true; // Set active true so we draw fallback loop
        });
    } else {
      // Turn Camera OFF
      const stream = videoFeed.srcObject;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      videoFeed.srcObject = null;
      cameraActive = false;
      btnCameraPower.textContent = "Start Camera";
      btnCameraPower.classList.remove("active");
      gpsStatusBadge.textContent = "GPS LOCKED";
      
      // Stop face tracking
      if (trackerTask) {
        trackerTask.stop();
        trackerTask = null;
        lastDetectedFace = null;
      }
    }
  });

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

  function processWebcamFeed() {
    const w = riderCanvas.width;
    const h = riderCanvas.height;
    
    if (activeFilter === "THERMAL") {
      // Draw input to offscreen canvas
      const tw = thermalCanvas.width;
      const th = thermalCanvas.height;
      
      if (cameraActive && videoFeed.srcObject && videoFeed.readyState === videoFeed.HAVE_ENOUGH_DATA) {
        thermalCtx.drawImage(videoFeed, 0, 0, tw, th);
      } else {
        // Draw Simulated Grayscale Thermal Scene
        thermalCtx.fillStyle = "rgb(15, 15, 22)"; // Ambient background temperature (Cold)
        thermalCtx.fillRect(0, 0, tw, th);
        
        // Faint background warmth structures (e.g. wall panels, warm screen)
        thermalCtx.fillStyle = "rgb(35, 35, 45)";
        thermalCtx.fillRect(40, 30, 80, 70);
        thermalCtx.fillRect(200, 40, 70, 80);
        // Synchronize simulated patrol coordinates with the smooth eased coordinates
        patrolX = (currentBoxX / 100) * tw;
        patrolY = (currentBoxY / 100) * th;
            const nonLinearSpeedRatio = getNonLinearSpeedRatio(currentSpeed);
        
        // Dynamic coupling connection: resistance affects thermal heat signature size/brightness functionally
        const effectiveHeatMultiplier = thermalHeatMultiplier + (currentResistance / 100) * 0.4;
        
        // Heat core size expands as speed goes up, amplified by heat factor
        const headRadius = 22 + nonLinearSpeedRatio * 14 * effectiveHeatMultiplier;
        const torsoWidth = 46 + nonLinearSpeedRatio * 20 * effectiveHeatMultiplier;
        const torsoHeight = 40 + nonLinearSpeedRatio * 12 * effectiveHeatMultiplier;
        
        // Grayscale intensities (hot spots start cold (around ambient 15) and get hotter as speed goes up)
        const torsoIntensity = Math.min(255, Math.round(15 + nonLinearSpeedRatio * 155 * effectiveHeatMultiplier));
        const headIntensity = Math.min(255, Math.round(15 + nonLinearSpeedRatio * 225 * effectiveHeatMultiplier));
        const faceIntensity = Math.min(255, Math.round(15 + nonLinearSpeedRatio * 235 * effectiveHeatMultiplier));
        const eyeIntensity = Math.min(255, Math.round(15 + nonLinearSpeedRatio * 240 * effectiveHeatMultiplier));
        
        // We'll draw with a blur filter to blend the heat signatures naturally
        thermalCtx.filter = "blur(8px)";
        
        // Torso/shoulders
        thermalCtx.fillStyle = `rgb(${torsoIntensity}, ${torsoIntensity}, ${torsoIntensity})`;
        thermalCtx.beginPath();
        thermalCtx.ellipse(patrolX, patrolY + 60, torsoWidth, torsoHeight, 0, 0, 2 * Math.PI);
        thermalCtx.fill();
        
        // Head/neck
        thermalCtx.fillStyle = `rgb(${headIntensity}, ${headIntensity}, ${headIntensity})`;
        thermalCtx.beginPath();
        thermalCtx.arc(patrolX, patrolY, headRadius, 0, 2 * Math.PI);
        thermalCtx.fill();
        
        // Face center
        thermalCtx.fillStyle = `rgb(${faceIntensity}, ${faceIntensity}, ${faceIntensity})`;
        thermalCtx.beginPath();
        thermalCtx.ellipse(patrolX, patrolY, headRadius * 0.5, headRadius * 0.7, 0, 0, 2 * Math.PI);
        thermalCtx.fill();
        
        // Eyes/nose (White hot core)
        thermalCtx.fillStyle = `rgb(${eyeIntensity}, ${eyeIntensity}, ${eyeIntensity})`;
        thermalCtx.beginPath();
        thermalCtx.arc(patrolX - (headRadius * 0.25), patrolY - (headRadius * 0.15), headRadius * 0.15, 0, 2 * Math.PI);
        thermalCtx.arc(patrolX + (headRadius * 0.25), patrolY - (headRadius * 0.15), headRadius * 0.15, 0, 2 * Math.PI);
        thermalCtx.arc(patrolX, patrolY + (headRadius * 0.1), headRadius * 0.1, 0, 2 * Math.PI);
        thermalCtx.fill();
        // Hot handheld device/helmet signature (e.g. coffee mug / target element) - also scales down to cold base when stopped
        const itemIntensity1 = Math.min(255, Math.round(15 + nonLinearSpeedRatio * 200 * effectiveHeatMultiplier));
        const itemIntensity2 = Math.min(255, Math.round(15 + nonLinearSpeedRatio * 237 * effectiveHeatMultiplier));
        const itemX = patrolX - 45;
        const itemY = patrolY + 53;
        thermalCtx.fillStyle = `rgb(${itemIntensity1}, ${itemIntensity1}, ${itemIntensity1})`;
        thermalCtx.beginPath();
        thermalCtx.arc(itemX, itemY, 16, 0, 2 * Math.PI);
        thermalCtx.fill();
        thermalCtx.fillStyle = `rgb(${itemIntensity2}, ${itemIntensity2}, ${itemIntensity2})`;
        thermalCtx.beginPath();
        thermalCtx.arc(itemX, itemY, 8, 0, 2 * Math.PI);
        thermalCtx.fill();
        
        // Ambient air heat anomalies floating up (also fade out to cold ambient 15 when stopped)
        for (let i = 0; i < 3; i++) {
          const tIdx = (animationTime * 0.5 + i * 0.3) % 1.0;
          const fx = 60 + i * 80 + Math.sin(animationTime + i) * 15;
          const fy = th - (tIdx * th);
          const fRadius = 8 + (1.0 - tIdx) * 12;
          
          const anomalyIntensity = Math.min(255, Math.round(15 + nonLinearSpeedRatio * 45));
          thermalCtx.fillStyle = `rgb(${anomalyIntensity}, ${anomalyIntensity}, ${anomalyIntensity})`;
          thermalCtx.beginPath();
          thermalCtx.arc(fx, fy, fRadius, 0, 2 * Math.PI);
          thermalCtx.fill();
        }
        
        thermalCtx.filter = "none"; // Reset filter
      }
      
      // Extract pixels and apply LUT mapping
      const imgData = thermalCtx.getImageData(0, 0, tw, th);
      const pixels = imgData.data;
      
      // Dynamic noise overlay for sensor feel
      const noiseVal = 6;
      
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        
        // Grayscale conversion
        let val = 0.299 * r + 0.587 * g + 0.114 * b;
        
        // Add subtle pixel noise for webcam feed
        if (cameraActive) {
          const noise = (Math.random() - 0.5) * noiseVal;
          val += noise;
        }

        // Apply non-linear speed mapping to color intensity
        const nonLinearSpeedRatio = getNonLinearSpeedRatio(currentSpeed);
        val = val * nonLinearSpeedRatio;
        
        // Thermal span dynamic sensitivity scaling with NaN guard
        const currentCeiling = (maxScaleTemp && !isNaN(maxScaleTemp)) ? maxScaleTemp : 80;
        const scaleFactor = 80 / currentCeiling;
        val = val * scaleFactor;

        // Expand contrast slightly to make colors pop
        val = (val - 110) * 1.4 + 110;
        
        // Clamp
        if (val < 0) val = 0;
        if (val > 255) val = 255;
        
        const idx = Math.round(val);
        pixels[i] = thermalLUT[idx * 3];
        pixels[i + 1] = thermalLUT[idx * 3 + 1];
        pixels[i + 2] = thermalLUT[idx * 3 + 2];
      }
      
      thermalCtx.putImageData(imgData, 0, 0);
      
      // Draw back to main canvas with retro pixelated stretching
      riderCtx.imageSmoothingEnabled = false;
      riderCtx.drawImage(thermalCanvas, 0, 0, w, h);
      
      // Update dynamic HUD overlays
      updateThermalOverlayTracker();
    } else {
      // Apply filters directly to canvas context
      if (activeFilter === "CINEMATIC") {
        riderCtx.filter = "contrast(1.05) saturate(1.1) brightness(0.95)";
      } else if (activeFilter === "GRAYSCALE") {
        riderCtx.filter = "grayscale(1) contrast(1.15)";
      } else {
        riderCtx.filter = "none";
      }

      if (cameraActive && videoFeed.srcObject && videoFeed.readyState === videoFeed.HAVE_ENOUGH_DATA) {
        riderCtx.imageSmoothingEnabled = true;
        riderCtx.drawImage(videoFeed, 0, 0, w, h);
      } else {
        // MODERN VECTOR RADAR FALLBACK (Apple style light-grey minimalist circles)
        riderCtx.fillStyle = "#121214";
        riderCtx.fillRect(0, 0, w, h);
        
        const cx = w / 2;
        const cy = h / 2;
        const radius = 90;
        
        riderCtx.strokeStyle = "rgba(255, 255, 255, 0.05)";
        riderCtx.lineWidth = 1;
        
        // Multi scope circle bounds
        for (let r = 1; r <= 3; r++) {
          riderCtx.beginPath();
          riderCtx.arc(cx, cy, radius * (r / 3), 0, 2 * Math.PI);
          riderCtx.stroke();
        }
        
        // Sweep radar line
        const sweepAngle = (animationTime * 0.9) % (2 * Math.PI);
        riderCtx.strokeStyle = "rgba(255, 255, 255, 0.15)";
        riderCtx.beginPath();
        riderCtx.moveTo(cx, cy);
        riderCtx.lineTo(cx + Math.cos(sweepAngle) * radius, cy + Math.sin(sweepAngle) * radius);
        riderCtx.stroke();
        
        // Draw a subtle coordinates text inside fallback screen
        riderCtx.fillStyle = "rgba(255, 255, 255, 0.2)";
        riderCtx.font = "11px 'Inter'";
        riderCtx.fillText("RADAR SENSOR ONLINE", cx - 60, cy - radius - 20);
      }
    }
  }
  function updateThermalOverlayTracker() {
    if (activeFilter !== "THERMAL") return;
    
    // 1. Dynamic temperature value based on speed and multiplier
    let currentTemp;
    const nonLinearSpeedRatio = getNonLinearSpeedRatio(currentSpeed);
    
    if (currentSpeed <= 0.05) {
      currentTemp = 0.0;
    } else {
      const currentCeiling = (maxScaleTemp && !isNaN(maxScaleTemp)) ? maxScaleTemp : 80;
      const speedHeat = nonLinearSpeedRatio * currentCeiling;
      const fluctuation = Math.sin(animationTime * 2.5) * 0.25;
      const noise = (Math.random() - 0.5) * 0.08;
      currentTemp = Math.max(0.1, Math.min(currentCeiling, speedHeat + fluctuation + noise));
    }
    
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

    // 2. Position tracking coordinates (using actual webcam face detection or fallback telemetry)
    let targetBoxX, targetBoxY;
    if (cameraActive && lastDetectedFace) {
      const vw = videoFeed.videoWidth || 1280;
      const vh = videoFeed.videoHeight || 720;
      const cx = lastDetectedFace.x + lastDetectedFace.width / 2;
      const cy = lastDetectedFace.y + lastDetectedFace.height / 2;
      
      // Convert pixel center coordinates to percentages of video size
      targetBoxX = (cx / vw) * 100;
      targetBoxY = (cy / vh) * 100;
    } else {
      // Fallback: use simulated movement coordinates with ping-pong boundaries
      targetBoxX = pingPong(gpsCoords.x * 0.2, 15, 85);
      targetBoxY = pingPong(gpsCoords.y * 0.2, 15, 75);
    }
    
    // Apply interpolation/easing to make target tracking box move smoothly
    currentBoxX = lerp(currentBoxX, targetBoxX, 0.08);
    currentBoxY = lerp(currentBoxY, targetBoxY, 0.08);
    
    if (thermalFaceBox) {
      thermalFaceBox.style.left = `${currentBoxX}%`;
      thermalFaceBox.style.top = `${currentBoxY}%`;
    }

    // Dynamic Scale Indicator follows the speed-mapped temperature if not being dragged
    if (scaleIndicator && !isDraggingScale) {
      const topPct = (1 - nonLinearSpeedRatio) * 100;
      scaleIndicator.style.top = `${topPct}%`;
    }

    // 3. Update Calibration load bar
    if (calCorrelationBar) {
      calCorrelationBar.style.width = `${Math.round(nonLinearSpeedRatio * 100)}%`;
    }

    // 4. Keep date up-to-date
    if (thermalMetaDate) {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const formattedDate = `${pad(now.getMonth() + 1)}/${pad(now.getDate())}/${String(now.getFullYear()).slice(-2)}`;
      thermalMetaDate.textContent = `Date:${formattedDate}`;
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

    // 3. Append static capture to the right side gallery scroll panel
    const galleryScrollPanel = document.getElementById("gallery-scroll-panel");
    if (galleryScrollPanel) {
      const imgDataUrl = riderCanvas.toDataURL("image/jpeg", 0.6);
      
      const card = document.createElement("div");
      card.className = "gallery-card";
      
      const img = document.createElement("img");
      img.src = imgDataUrl;
      img.alt = `Capture ${frameLabel}`;
      
      const overlay = document.createElement("div");
      overlay.className = "gallery-card-overlay";
      
      const topRow = document.createElement("div");
      topRow.className = "gallery-card-top";
      topRow.innerHTML = `<span>CAM-01</span><span class="gallery-card-frame">${frameLabel}</span>`;
      
      const bottomRow = document.createElement("div");
      bottomRow.className = "gallery-card-bottom";
      bottomRow.innerHTML = `<span>${timeStamp}</span><span style="color: #00e5ff;">CAPTURED</span>`;
      
      overlay.appendChild(topRow);
      overlay.appendChild(bottomRow);
      
      card.appendChild(img);
      card.appendChild(overlay);
      
      // Remove empty state
      const emptyState = galleryScrollPanel.querySelector(".gallery-empty-state");
      if (emptyState) {
        galleryScrollPanel.innerHTML = "";
      }
      
      // Insert at the top of the gallery
      galleryScrollPanel.insertBefore(card, galleryScrollPanel.firstChild);
    }




  }

  // --- 4. Mini Telemetry Trend Chart ---
  function setupChartCanvas() {
    resizeChartCanvas();
    window.addEventListener("resize", resizeChartCanvas);
  }

  function resizeChartCanvas() {
    const parent = chartCanvas.parentElement;
    chartCanvas.width = parent.clientWidth;
    chartCanvas.height = parent.clientHeight;
  }

  function drawTelemetryChart() {
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
  function drawMonitorCells() {
    // Mirror riderCanvas to all active monitor canvases in real time
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

  function mainRenderLoop(timestamp) {
    simulateTelemetry();
    processWebcamFeed();
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
});
