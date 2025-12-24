document.addEventListener('DOMContentLoaded', () => {
    const app = document.getElementById('app-content');
    const canvas = document.getElementById('box-canvas');
    const ctx = canvas ? canvas.getContext('2d') : null;
    if (!app || !canvas || !ctx) {
        return;
    }
    const layoutHost = canvas.parentElement || document.querySelector('.container');
    const initialWidth = layoutHost ? layoutHost.clientWidth : canvas.clientWidth;
    const initialHeight = layoutHost ? layoutHost.clientHeight : canvas.clientHeight;

    const state = {
        isPlaying: false,
        count: 0,
        countdown: 4,
        totalTime: 0,
        soundEnabled: false,
        timeLimit: '',
        sessionComplete: false,
        timeLimitReached: false,
        phaseTime: 4,
        pulseStartTime: null,
        devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2.5),
        viewportWidth: initialWidth,
        viewportHeight: initialHeight,
        prefersReducedMotion: false,
        hasStarted: false
    };

    let wakeLock = null;
    let audioContext = new (window.AudioContext || window.webkitAudioContext)();

    const icons = {
        play: `<svg class="icon" viewBox="0 0 24 24"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>`,
        pause: `<svg class="icon" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>`,
        volume2: `<svg class="icon" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`,
        volumeX: `<svg class="icon" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`,
        rotateCcw: `<svg class="icon" viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>`,
        clock: `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
        check: `<svg class="icon" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>`
    };

    function getInstruction(count) {
        switch (count) {
            case 0: return 'Inhale';
            case 1: return 'Hold';
            case 2: return 'Exhale';
            case 3: return 'Wait';
            default: return '';
        }
    }

    const phaseColors = ['#ff9f43', '#feca57', '#54a0ff', '#5ed5a8'];

    function hexToRgba(hex, alpha) {
        const normalized = hex.replace('#', '');
        const bigint = parseInt(normalized, 16);
        const r = (bigint >> 16) & 255;
        const g = (bigint >> 8) & 255;
        const b = bigint & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    let cachedGradient = null;
    let cachedGradientKey = '';

    function invalidateGradient() {
        cachedGradient = null;
        cachedGradientKey = '';
    }

    function resizeCanvas() {
        const currentSizingElement = layoutHost || document.body;
        if (!currentSizingElement) {
            return;
        }

        const rect = currentSizingElement.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2.5);

        state.viewportWidth = width;
        state.viewportHeight = height;
        state.devicePixelRatio = pixelRatio;

        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.width = Math.floor(width * pixelRatio);
        canvas.height = Math.floor(height * pixelRatio);

        if (ctx) {
            ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        }

        invalidateGradient();

        if (!state.isPlaying) {
            drawScene({ progress: state.sessionComplete ? 1 : 0, showTrail: false, phase: state.count });
        }
    }

    window.addEventListener('resize', resizeCanvas, { passive: true });

    function updateMotionPreference(event) {
        state.prefersReducedMotion = event.matches;
        if (!state.isPlaying) {
            drawScene({ progress: state.sessionComplete ? 1 : 0, showTrail: false, phase: state.count });
        }
    }

    const motionQuery = typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    if (motionQuery) {
        state.prefersReducedMotion = motionQuery.matches;
        if (typeof motionQuery.addEventListener === 'function') {
            motionQuery.addEventListener('change', updateMotionPreference);
        } else if (typeof motionQuery.addListener === 'function') {
            motionQuery.addListener(updateMotionPreference);
        }
    }

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    function playTone() {
        if (state.soundEnabled && audioContext) {
            try {
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(528, audioContext.currentTime);
                gainNode.gain.setValueAtTime(0.15, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);
                oscillator.start();
                oscillator.stop(audioContext.currentTime + 0.15);
            } catch (e) {
                console.error('Error playing tone:', e);
            }
        }
    }

    let interval;
    let animationFrameId;
    let lastStateUpdate;

    async function requestWakeLock() {
        if ('wakeLock' in navigator) {
            try {
                wakeLock = await navigator.wakeLock.request('screen');
                console.log('Wake lock is active');
            } catch (err) {
                console.error('Failed to acquire wake lock:', err);
            }
        } else {
            console.log('Wake Lock API not supported');
        }
    }

    function releaseWakeLock() {
        if (wakeLock !== null) {
            wakeLock.release()
                .then(() => {
                    wakeLock = null;
                    console.log('Wake lock released');
                })
                .catch(err => {
                    console.error('Failed to release wake lock:', err);
                });
        }
    }

    function togglePlay() {
        state.isPlaying = !state.isPlaying;
        if (state.isPlaying) {
            if (audioContext && audioContext.state === 'suspended') {
                audioContext.resume().then(() => {
                    console.log('AudioContext resumed');
                });
            }
            state.hasStarted = true;
            state.totalTime = 0;
            state.countdown = state.phaseTime;
            state.count = 0;
            state.sessionComplete = false;
            state.timeLimitReached = false;
            state.pulseStartTime = performance.now();
            playTone();
            startInterval();
            animate();
            requestWakeLock();
        } else {
            clearInterval(interval);
            cancelAnimationFrame(animationFrameId);
            state.totalTime = 0;
            state.countdown = state.phaseTime;
            state.count = 0;
            state.sessionComplete = false;
            state.timeLimitReached = false;
            state.hasStarted = false;
            invalidateGradient();
            drawScene({ progress: 0, showTrail: false, phase: state.count });
            state.pulseStartTime = null;
            releaseWakeLock();
        }
        render();
    }

    function resetToStart() {
        state.isPlaying = false;
        state.totalTime = 0;
        state.countdown = state.phaseTime;
        state.count = 0;
        state.sessionComplete = false;
        state.timeLimit = '';
        state.timeLimitReached = false;
        state.pulseStartTime = null;
        state.hasStarted = false;
        clearInterval(interval);
        cancelAnimationFrame(animationFrameId);
        invalidateGradient();
        drawScene({ progress: 0, showTrail: false, phase: state.count });
        releaseWakeLock();
        render();
    }

    function toggleSound() {
        state.soundEnabled = !state.soundEnabled;
        render();
    }

    function handleTimeLimitChange(e) {
        state.timeLimit = e.target.value.replace(/[^0-9]/g, '');
    }

    function startWithPreset(minutes) {
        state.timeLimit = minutes.toString();
        state.isPlaying = true;
        state.totalTime = 0;
        state.countdown = state.phaseTime;
        state.count = 0;
        state.sessionComplete = false;
        state.timeLimitReached = false;
        state.pulseStartTime = performance.now();
        state.hasStarted = true;
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                console.log('AudioContext resumed');
            });
        }
        playTone();
        startInterval();
        animate();
        requestWakeLock();
        render();
    }

    function startInterval() {
        clearInterval(interval);
        lastStateUpdate = performance.now();
        interval = setInterval(() => {
            state.totalTime += 1;
            if (state.timeLimit && !state.timeLimitReached) {
                const timeLimitSeconds = parseInt(state.timeLimit) * 60;
                if (state.totalTime >= timeLimitSeconds) {
                    state.timeLimitReached = true;
                }
            }
            if (state.countdown === 1) {
                state.count = (state.count + 1) % 4;
                state.pulseStartTime = performance.now();
                state.countdown = state.phaseTime;
                playTone();
                if (state.count === 3 && state.timeLimitReached) {
                    state.sessionComplete = true;
                    state.isPlaying = false;
                    state.hasStarted = false;
                    clearInterval(interval);
                    cancelAnimationFrame(animationFrameId);
                    releaseWakeLock();
                }
            } else {
                state.countdown -= 1;
            }
            lastStateUpdate = performance.now();
            render();
        }, 1000);
    }

    function drawScene({ progress = 0, phase = state.count, showTrail = state.isPlaying, timestamp = performance.now() } = {}) {
        if (!ctx) return;

        const width = state.viewportWidth || canvas.clientWidth || canvas.width;
        const height = state.viewportHeight || canvas.clientHeight || canvas.height;
        if (!width || !height) {
            return;
        }

        const scale = state.devicePixelRatio || 1;
        ctx.save();
        ctx.setTransform(scale, 0, 0, scale, 0, 0);

        ctx.clearRect(0, 0, width, height);

        if (!state.hasStarted && !state.sessionComplete) {
            invalidateGradient();
            ctx.restore();
            return;
        }

        const clampedProgress = Math.max(0, Math.min(1, progress));
        const easedProgress = 0.5 - (Math.cos(Math.PI * clampedProgress) / 2);
        const baseSize = Math.min(width, height) * 0.55;
        const topMargin = 20;
        const sizeWithoutBreath = Math.min(baseSize, height - topMargin * 2);
        const verticalOffset = Math.min(height * 0.12, 80);
        const preferredTop = height / 2 + verticalOffset - sizeWithoutBreath / 2;
        const top = Math.max(topMargin, Math.min(preferredTop, height - sizeWithoutBreath - topMargin));
        const left = (width - sizeWithoutBreath) / 2;

        const now = timestamp;
        const allowMotion = !state.prefersReducedMotion;
        let breathInfluence = 0;
        if (phase === 0) {
            breathInfluence = easedProgress;
        } else if (phase === 2) {
            breathInfluence = 1 - easedProgress;
        } else if (allowMotion) {
            breathInfluence = 0.3 + 0.2 * (0.5 + 0.5 * Math.sin(now / 350));
        } else {
            breathInfluence = 0.3;
        }

        let pulseBoost = 0;
        if (allowMotion && state.pulseStartTime !== null) {
            const pulseElapsed = (now - state.pulseStartTime) / 1000;
            if (pulseElapsed < 0.5) {
                pulseBoost = Math.sin((pulseElapsed / 0.5) * Math.PI) * 0.8;
            }
        }

        const size = sizeWithoutBreath * (1 + 0.06 * breathInfluence + 0.02 * pulseBoost);
        const adjustedLeft = left + (sizeWithoutBreath - size) / 2;
        const adjustedTop = top + (sizeWithoutBreath - size) / 2;
        
        const cornerRadius = size * 0.08;
        
        const points = [
            { x: adjustedLeft + cornerRadius, y: adjustedTop + size - cornerRadius },
            { x: adjustedLeft + cornerRadius, y: adjustedTop + cornerRadius },
            { x: adjustedLeft + size - cornerRadius, y: adjustedTop + cornerRadius },
            { x: adjustedLeft + size - cornerRadius, y: adjustedTop + size - cornerRadius }
        ];
        
        const startPoint = points[phase];
        const endPoint = points[(phase + 1) % 4];
        const currentX = startPoint.x + easedProgress * (endPoint.x - startPoint.x);
        const currentY = startPoint.y + easedProgress * (endPoint.y - startPoint.y);

        const accentColor = phaseColors[phase] || '#ff9f43';
        const shouldShowTrail = allowMotion && showTrail;

        // Background glow
        const glowGradient = ctx.createRadialGradient(
            adjustedLeft + size / 2,
            adjustedTop + size / 2,
            size * 0.1,
            adjustedLeft + size / 2,
            adjustedTop + size / 2,
            size * 1.2
        );
        glowGradient.addColorStop(0, hexToRgba(accentColor, 0.12));
        glowGradient.addColorStop(0.5, hexToRgba(accentColor, 0.04));
        glowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glowGradient;
        ctx.fillRect(0, 0, width, height);

        // Draw rounded rectangle path
        function roundedRect(x, y, w, h, r) {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + r);
            ctx.lineTo(x + w, y + h - r);
            ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            ctx.lineTo(x + r, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
        }

        // Base square with subtle border
        ctx.save();
        roundedRect(adjustedLeft, adjustedTop, size, size, cornerRadius);
        ctx.strokeStyle = hexToRgba('#ffffff', 0.06);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();

        // Progress trail
        ctx.lineWidth = Math.max(3, size * 0.018);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        // Create gradient for the trail
        const trailGradient = ctx.createLinearGradient(
            adjustedLeft, adjustedTop,
            adjustedLeft + size, adjustedTop + size
        );
        trailGradient.addColorStop(0, hexToRgba(accentColor, shouldShowTrail ? 0.9 : 0.5));
        trailGradient.addColorStop(1, hexToRgba(phaseColors[(phase + 1) % 4], shouldShowTrail ? 0.9 : 0.5));
        
        ctx.strokeStyle = trailGradient;
        ctx.shadowColor = hexToRgba(accentColor, 0.6);
        ctx.shadowBlur = shouldShowTrail ? 20 : 10;
        
        ctx.beginPath();
        
        // Draw completed sides with rounded corners
        const corners = [
            { x: adjustedLeft, y: adjustedTop + size },
            { x: adjustedLeft, y: adjustedTop },
            { x: adjustedLeft + size, y: adjustedTop },
            { x: adjustedLeft + size, y: adjustedTop + size }
        ];
        
        ctx.moveTo(corners[0].x + cornerRadius, corners[0].y - cornerRadius);
        
        for (let i = 1; i <= phase; i++) {
            if (i === 1) {
                ctx.lineTo(corners[1].x + cornerRadius, corners[1].y + cornerRadius);
                ctx.quadraticCurveTo(corners[1].x, corners[1].y, corners[1].x + cornerRadius, corners[1].y);
            } else if (i === 2) {
                ctx.lineTo(corners[2].x - cornerRadius, corners[2].y);
                ctx.quadraticCurveTo(corners[2].x, corners[2].y, corners[2].x, corners[2].y + cornerRadius);
            } else if (i === 3) {
                ctx.lineTo(corners[3].x, corners[3].y - cornerRadius);
                ctx.quadraticCurveTo(corners[3].x, corners[3].y, corners[3].x - cornerRadius, corners[3].y);
            }
        }
        
        if (shouldShowTrail) {
            ctx.lineTo(currentX, currentY);
        }
        
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Animated dot
        const baseRadius = Math.max(6, size * 0.028);
        let radius = baseRadius * (1 + 0.3 * breathInfluence + 0.2 * pulseBoost);
        if (allowMotion && (phase === 1 || phase === 3)) {
            radius += baseRadius * 0.1 * (0.5 + 0.5 * Math.sin(now / 180));
        }

        // Outer glow
        const dotGlow = ctx.createRadialGradient(
            currentX, currentY, 0,
            currentX, currentY, radius * 3
        );
        dotGlow.addColorStop(0, hexToRgba(accentColor, 0.4));
        dotGlow.addColorStop(0.5, hexToRgba(accentColor, 0.1));
        dotGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.beginPath();
        ctx.arc(currentX, currentY, radius * 3, 0, 2 * Math.PI);
        ctx.fillStyle = dotGlow;
        ctx.fill();

        // Main dot
        const dotGradient = ctx.createRadialGradient(
            currentX - radius * 0.3, currentY - radius * 0.3, 0,
            currentX, currentY, radius
        );
        dotGradient.addColorStop(0, '#ffffff');
        dotGradient.addColorStop(0.3, accentColor);
        dotGradient.addColorStop(1, hexToRgba(accentColor, 0.8));
        
        ctx.beginPath();
        ctx.arc(currentX, currentY, radius, 0, 2 * Math.PI);
        ctx.fillStyle = dotGradient;
        ctx.shadowColor = accentColor;
        ctx.shadowBlur = 15;
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.restore();
    }

    function updateCanvasVisibility() {
        const shouldShow = state.isPlaying || state.sessionComplete;
        canvas.classList.toggle('is-visible', shouldShow);
    }

    function animate() {
        if (!state.isPlaying) return;
        const now = performance.now();
        const elapsed = (now - lastStateUpdate) / 1000;
        const effectiveCountdown = state.countdown - elapsed;
        let progress = (state.phaseTime - effectiveCountdown) / state.phaseTime;
        progress = Math.max(0, Math.min(1, progress));

        drawScene({ progress, timestamp: now });

        animationFrameId = requestAnimationFrame(animate);
    }

    function render() {
        let html = `
            <h1>Box Breathing</h1>
            <p class="subtitle">Find your calm</p>
        `;
        
        if (state.isPlaying) {
            html += `
                <div class="timer">${formatTime(state.totalTime)}</div>
                <div class="instruction">${getInstruction(state.count)}</div>
                <div class="countdown">${state.countdown}</div>
            `;
            const phases = ['Inhale', 'Hold', 'Exhale', 'Wait'];
            html += `<div class="phase-tracker">`;
            phases.forEach((label, index) => {
                const phaseColor = phaseColors[index] || '#a0a0b0';
                html += `
                    <div class="phase-item ${index === state.count ? 'active' : ''}" style="--phase-color: ${phaseColor};">
                        <span class="phase-dot" style="--phase-color: ${phaseColor};"></span>
                        <span class="phase-label">${label}</span>
                    </div>
                `;
            });
            html += `</div>`;
        }
        
        if (state.timeLimitReached && !state.sessionComplete) {
            const limitMessage = state.isPlaying ? 'Completing cycle…' : 'Time limit reached';
            html += `<div class="limit-warning">${limitMessage}</div>`;
        }
        
        if (!state.isPlaying && !state.sessionComplete) {
            html += `
                <div class="settings">
                    <div class="card">
                        <div class="form-group">
                            <label>
                                ${state.soundEnabled ? icons.volume2 : icons.volumeX}
                                Sound
                            </label>
                            <label class="switch">
                                <input type="checkbox" id="sound-toggle" ${state.soundEnabled ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                    </div>
                    <div class="card">
                        <div class="input-wrapper">
                            <label for="time-limit">Session Duration (optional)</label>
                            <input
                                type="number"
                                inputmode="numeric"
                                placeholder="Enter minutes"
                                value="${state.timeLimit}"
                                id="time-limit"
                                step="1"
                                min="0"
                            >
                        </div>
                    </div>
                </div>
                <p class="prompt">Tap to begin your session</p>
            `;
        }
        
        if (state.sessionComplete) {
            html += `<div class="complete">${icons.check} Session Complete</div>`;
        }
        
        if (!state.sessionComplete) {
            html += `
                <button id="toggle-play">
                    ${state.isPlaying ? icons.pause : icons.play}
                    ${state.isPlaying ? 'Pause' : 'Start'}
                </button>
            `;
        }
        
        if (!state.isPlaying && !state.sessionComplete) {
            html += `
                <div class="slider-container">
                    <div class="card">
                        <div class="slider-header">
                            <label>Phase Duration</label>
                            <span class="slider-value" id="phase-time-value">${state.phaseTime}s</span>
                        </div>
                        <div class="range-wrapper">
                            <input type="range" min="3" max="6" step="1" value="${state.phaseTime}" id="phase-time-slider">
                        </div>
                        <div class="range-labels">
                            <span>3s</span>
                            <span>6s</span>
                        </div>
                    </div>
                </div>
            `;
        }
        
        if (state.sessionComplete) {
            html += `
                <button id="reset">
                    ${icons.rotateCcw}
                    New Session
                </button>
            `;
        }
        
        if (!state.isPlaying && !state.sessionComplete) {
            html += `
                <div class="shortcut-buttons">
                    <button id="preset-2min" class="preset-button">
                        ${icons.clock} 2 min
                    </button>
                    <button id="preset-5min" class="preset-button">
                        ${icons.clock} 5 min
                    </button>
                    <button id="preset-10min" class="preset-button">
                        ${icons.clock} 10 min
                    </button>
                </div>
            `;
        }
        
        app.innerHTML = html;

        updateCanvasVisibility();

        if (!state.sessionComplete) {
            document.getElementById('toggle-play').addEventListener('click', togglePlay);
        }
        if (state.sessionComplete) {
            document.getElementById('reset').addEventListener('click', resetToStart);
        }
        if (!state.isPlaying && !state.sessionComplete) {
            document.getElementById('sound-toggle').addEventListener('change', toggleSound);
            const timeLimitInput = document.getElementById('time-limit');
            timeLimitInput.addEventListener('input', handleTimeLimitChange);
            const phaseTimeSlider = document.getElementById('phase-time-slider');
            phaseTimeSlider.addEventListener('input', function() {
                state.phaseTime = parseInt(this.value);
                state.countdown = state.phaseTime;
                document.getElementById('phase-time-value').textContent = state.phaseTime + 's';
            });
            document.getElementById('preset-2min').addEventListener('click', () => startWithPreset(2));
            document.getElementById('preset-5min').addEventListener('click', () => startWithPreset(5));
            document.getElementById('preset-10min').addEventListener('click', () => startWithPreset(10));
        }
        if (!state.isPlaying) {
            drawScene({ progress: state.sessionComplete ? 1 : 0, phase: state.count, showTrail: false });
        }
    }

    render();
    resizeCanvas();
});