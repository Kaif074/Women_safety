import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, push } from "firebase/database";
import './App.css';

// ── Firebase Config ─────────────────────────────────────────
const firebaseConfig = {
  apiKey:            process.env.REACT_APP_FIREBASE_API_KEY || "AIzaSyBq_5hpdlyvo8IUhSRIyZhCgtVnmAdV7zU",
  authDomain:        process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || "touch-sensor-84fa0.firebaseapp.com",
  databaseURL:       process.env.REACT_APP_FIREBASE_DATABASE_URL || "https://touch-sensor-84fa0-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         process.env.REACT_APP_FIREBASE_PROJECT_ID || "touch-sensor-84fa0",
  storageBucket:     process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || "touch-sensor-84fa0.firebasestorage.app",
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || "1075797850210",
  appId:             process.env.REACT_APP_FIREBASE_APP_ID || "1:1075797850210:web:0331d5458f1729a0b3f93b",
  measurementId:     process.env.REACT_APP_FIREBASE_MEASUREMENT_ID || "G-F5B4FDK67W",
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

// ── Firebase Paths ───────────────────────────────────────────
const PATHS = {
  device:    "women_safety_device",
  buzzer:    "women_safety_device/buzzer",
  emergency: "women_safety_device/emergency_system",
  status:    "women_safety_device/status",
  gps:       "women_safety_device/gps",
  contacts:  "women_safety_device/emergency_contacts",
  alerts:    "women_safety_device/alert_history",
};

function Toast({ message, type }) {
  const palette = {
    safe:    { border: "rgba(34,197,94,0.4)",   text: "#22c55e" },
    danger:  { border: "rgba(239,68,68,0.4)",   text: "#ef4444" },
    warning: { border: "rgba(245,158,11,0.4)",  text: "#f59e0b" },
    info:    { border: "rgba(108,99,255,0.4)",  text: "#6c63ff" },
  };
  const c = palette[type] || palette.info;

  return (
    <div className="toast-item" style={{
      background: "#12151d",
      border: `1px solid ${c.border}`,
      borderLeft: `3px solid ${c.text}`,
      color: c.text,
      fontSize: '13px',
      fontFamily: "'DM Sans', sans-serif",
      padding: '10px 16px',
      borderRadius: '10px',
      pointerEvents: 'none',
      opacity: 1,
      transform: 'translateX(0)',
      transition: 'all 0.3s cubic-bezier(0.34,1.56,0.64,1)',
      maxWidth: '290px',
      lineHeight: 1.4
    }}>
      {message}
    </div>
  );
}

function App() {
  // ── State ───────────────────────────────────────────────────
  const [contacts, setContacts] = useState(() => {
    const saved = localStorage.getItem("wsd_contacts");
    return saved ? JSON.parse(saved) : [];
  });
  const [currentGPS, setCurrentGPS] = useState(null);
  const [isEmergency, setIsEmergency] = useState(false);
  const [alertSent, setAlertSent] = useState(false);
  const [activityLog, setActivityLog] = useState([]);
  const [buzzer, setBuzzer] = useState(0);
  const [emergencySystem, setEmergencySystem] = useState("off");
  const [deviceStatus, setDeviceStatus] = useState("safe");
  const [lastSync, setLastSync] = useState("—");
  const [toasts, setToasts] = useState([]);

  const gpsWatchIdRef = useRef(null);
  const newNameRef = useRef(null);
  const newNumberRef = useRef(null);

  const ts = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const isoNow = () => new Date().toISOString();

  // ── Toast Notifications ───────────────────────────────────────
  const showToast = useCallback((message, type = "info") => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  }, []);

  // ── Activity Log ─────────────────────────────────────────────
  const addLog = useCallback((text, type = "info") => {
    setActivityLog(prev => {
      const newList = [{ text, type, time: ts() }, ...prev];
      return newList.slice(0, 30);
    });
  }, []);

  // ── Contacts Sync ────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem("wsd_contacts", JSON.stringify(contacts));
    
    // Sync to Firebase
    const contactsObj = {};
    contacts.forEach((c, i) => {
      contactsObj[`contact_${i + 1}`] = { name: c.name, number: c.number };
    });
    set(ref(db, PATHS.contacts), contactsObj)
      .catch((e) => addLog("Contacts Firebase sync failed: " + e.message, "danger"));
  }, [contacts, addLog]);

  const addContact = () => {
    const name = newNameRef.current.value.trim();
    const number = newNumberRef.current.value.trim();

    if (!number) { showToast("Please enter a phone number", "danger"); return; }
    if (!number.startsWith("+")) { showToast("Include country code · e.g. +919876543210", "warning"); return; }

    setContacts(prev => [...prev, { name: name || "Contact", number }]);
    newNameRef.current.value = "";
    newNumberRef.current.value = "";
    addLog(`Contact added: ${name || "Contact"} (${number})`, "info");
    showToast("Contact saved to Firebase ✓", "safe");
  };

  const removeContact = (index) => {
    const removed = contacts[index];
    setContacts(prev => prev.filter((_, i) => i !== index));
    addLog(`Contact removed: ${removed.name}`, "info");
    showToast(`${removed.name} removed`, "warning");
  };

  const initials = (name) => {
    return name.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("");
  };

  // ── GPS Tracking ─────────────────────────────────────────────
  const startGPS = useCallback(() => {
    if (!navigator.geolocation) {
      addLog("GPS not supported by browser", "danger");
      return;
    }

    if (gpsWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchIdRef.current);
    }

    gpsWatchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const gps = {
          lat:       parseFloat(pos.coords.latitude.toFixed(6)),
          lng:       parseFloat(pos.coords.longitude.toFixed(6)),
          accuracy:  Math.round(pos.coords.accuracy),
          timestamp: isoNow(),
          maps_link: `https://maps.google.com/?q=${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`,
        };
        setCurrentGPS(gps);
        window._currentGPS = gps; // For external script if any
        set(ref(db, PATHS.gps), gps);
      },
      (err) => {
        addLog("GPS error: " + err.message, "danger");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  }, [addLog]);

  const refreshGPS = () => {
    startGPS();
    showToast("Refreshing GPS…", "info");
  };

  const openGoogleMaps = () => {
    if (currentGPS) {
      window.open(currentGPS.maps_link, "_blank");
    }
  };

  // ── Firebase Alert History ───────────────────────────────────
  const saveAlertToFirebase = useCallback(() => {
    if (!currentGPS) return;

    const alertData = {
      triggered_at:       isoNow(),
      gps: {
        lat:       currentGPS.lat,
        lng:       currentGPS.lng,
        accuracy:  currentGPS.accuracy,
        maps_link: currentGPS.maps_link,
      },
      notified_contacts: contacts.map((c) => ({ name: c.name, number: c.number })),
      status:            "emergency",
    };

    push(ref(db, PATHS.alerts), alertData)
      .then(() => addLog("Emergency alert saved to Firebase history ✓", "info"))
      .catch((e) => addLog("Alert history save failed: " + e.message, "danger"));

    set(ref(db, PATHS.gps), { ...currentGPS, emergency: true });
  }, [currentGPS, contacts, addLog]);

  // ── WhatsApp Alert ────────────────────────────────────────────
  const sendWhatsApp = useCallback(() => {
    if (contacts.length === 0) {
      showToast("Add at least one emergency contact first!", "danger");
      return;
    }

    const gpsLine = currentGPS
      ? `📍 Live location:\n${currentGPS.maps_link}`
      : "📍 Location unavailable — contact authorities immediately";

    const message = encodeURIComponent(
      `🚨 *EMERGENCY ALERT* 🚨\n\n` +
      `Women Safety Device has been triggered!\n\n` +
      `${gpsLine}\n\n` +
      `Please respond immediately and contact authorities if needed.\n\n` +
      `_Sent via FemmeGuard Safety Dashboard_`
    );

    contacts.forEach((c) => {
      const num = c.number.replace(/\D/g, "");
      window.open(`https://wa.me/${num}?text=${message}`, "_blank");
    });

    saveAlertToFirebase();
    addLog(`🚨 WhatsApp alert sent to ${contacts.length} contact(s)`, "danger");
    showToast(`Alert sent to ${contacts.length} contact(s) ✓`, "safe");
  }, [contacts, currentGPS, showToast, saveAlertToFirebase, addLog]);

  const markSafe = () => {
    set(ref(db, PATHS.device), {
      buzzer:             0,
      emergency_system:   "off",
      status:             "safe",
      gps:                currentGPS || null,
      emergency_contacts: (() => {
        const obj = {};
        contacts.forEach((c, i) => { obj[`contact_${i + 1}`] = { name: c.name, number: c.number }; });
        return obj;
      })(),
    });
    addLog("✅ Device manually marked as SAFE", "safe");
    showToast("Device marked as safe ✓", "safe");
  };

  // ── Firebase Listener ─────────────────────────────────────────
  useEffect(() => {
    const deviceRef = ref(db, PATHS.device);
    const unsubscribe = onValue(deviceRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      const b = data.buzzer ?? 0;
      const es = data.emergency_system ?? "off";
      const s = data.status ?? "safe";

      setBuzzer(b);
      setEmergencySystem(es);
      setDeviceStatus(s);
      setLastSync(`Last sync: ${ts()}`);

      const newEmergency = b === 1 || es === "on" || s === "EMERGENCY";
      setIsEmergency(newEmergency);

      if (newEmergency && !alertSent) {
        setAlertSent(true);
        addLog("🚨 Emergency triggered by physical device!", "danger");
        startGPS();
        // Auto-send WhatsApp alerts
        sendWhatsApp();
        // Auto-save alert after delay for GPS sync
        setTimeout(() => {
          saveAlertToFirebase();
        }, 2000);
      } else if (!newEmergency) {
        setAlertSent(false);
      }
    });

    return () => unsubscribe();
  }, [alertSent, startGPS, saveAlertToFirebase, addLog, sendWhatsApp]);

  // ── Init ──────────────────────────────────────────────────────
  useEffect(() => {
    startGPS();
    addLog("Dashboard connected to Firebase ✓", "info");
    addLog("GPS tracking started", "info");
    addLog(`${contacts.length} emergency contact(s) loaded`, "info");
    console.log("%c FemmeGuard Dashboard v2 ", "background:#6c63ff;color:#fff;font-size:14px;padding:4px 10px;border-radius:6px;font-weight:bold;");

    return () => {
      if (gpsWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
      }
    };
  }, [startGPS, addLog, contacts.length]); // Run once on mount and sync dependencies

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="app-wrapper">
      {/* ── Header ────────────────────────────────────────── */}
      <header className="app-header animate-up">
        <div className="header-brand">
          <div className="brand-icon">🛡️</div>
          <div>
            <div className="brand-name">FemmeGuard</div>
            <div className="brand-sub">Women Safety Device Dashboard</div>
          </div>
        </div>
        <div className="header-live">
          <span className="live-dot" style={{ 
            background: isEmergency ? "var(--danger-color)" : "var(--safe-color)",
            boxShadow: `0 0 8px ${isEmergency ? "var(--danger-color)" : "var(--safe-color)"}`
          }}></span>
          Firebase Live
        </div>
      </header>

      {/* ── Emergency Banner ──────────────────────────────── */}
      <div className={`emergency-banner ${isEmergency ? 'visible' : ''}`} id="emergency-banner">
        <div className="banner-inner">
          <div className="banner-title">
            <i className="ti ti-alert-triangle"></i>
            Emergency Detected!
            <span className="sos-badge">SOS</span>
          </div>
          <p className="banner-desc">
            The safety device has been triggered. GPS location will be sent via WhatsApp to your emergency contacts.
          </p>
          <div className="banner-actions">
            <button className="btn btn-whatsapp" onClick={sendWhatsApp}>
              <i className="ti ti-brand-whatsapp"></i> Send WhatsApp Alert
            </button>
            <button className="btn btn-safe" onClick={markSafe}>
              <i className="ti ti-check"></i> Mark as Safe
            </button>
          </div>
        </div>
      </div>

      {/* ── Status Hero ────────────────────────────────────── */}
      <div className={`status-hero animate-up delay-1 ${isEmergency ? 'emergency' : 'safe'}`} id="status-hero">
        <div className="status-main">
          <div className="status-left">
            <div className="status-label">Device Status</div>
            <div className={`status-value ${isEmergency ? 'danger' : ''}`} id="status-value">
              {isEmergency ? "EMERGENCY" : "Safe"}
            </div>
            <div className={`status-badge ${isEmergency ? 'danger' : ''}`} id="status-badge">
              <span className={`badge-dot ${isEmergency ? 'blink' : ''}`}></span>
              {isEmergency ? "Alert active" : "All clear"}
            </div>
          </div>
          <div className="status-ring-wrap">
            <div className="ring-stat">
              <div className="ring-val" style={{ color: emergencySystem === 'on' ? 'var(--danger-color)' : 'var(--safe-color)' }}>
                {emergencySystem.toUpperCase()}
              </div>
              <div className="ring-lbl">Emergency</div>
            </div>
            <div style={{ width: '1px', height: '40px', background: 'var(--border)' }}></div>
            <div className="ring-stat">
              <div className="ring-val" style={{ color: buzzer === 1 ? 'var(--danger-color)' : 'var(--safe-color)' }}>
                {buzzer === 1 ? "ON" : "OFF"}
              </div>
              <div className="ring-lbl">Buzzer</div>
            </div>
            <div style={{ width: '1px', height: '40px', background: 'var(--border)' }}></div>
            <div className="ring-stat">
              <div className="ring-val" style={{ color: deviceStatus === 'EMERGENCY' ? 'var(--danger-color)' : 'var(--safe-color)' }}>
                {deviceStatus}
              </div>
              <div className="ring-lbl">Status</div>
            </div>
          </div>
        </div>
        <div className="conn-bar">
          <span className="conn-indicator" id="conn-dot"></span>
          <span>Connected to Firebase Realtime DB</span>
          <span style={{ marginLeft: 'auto', fontSize: '11px' }}>{lastSync}</span>
        </div>
      </div>

      {/* ── Stat Cards ────────────────────────────────────── */}
      <div className="stats-grid animate-up delay-2">
        <div className="stat-card">
          <div className="stat-icon">📡</div>
          <div className="stat-num" style={{ color: buzzer === 1 ? 'var(--danger-color)' : 'var(--safe-color)' }}>
            {buzzer === 1 ? "ON" : "OFF"}
          </div>
          <div className="stat-label">Buzzer State</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🚨</div>
          <div className="stat-num" style={{ color: emergencySystem === 'on' ? 'var(--danger-color)' : 'var(--safe-color)' }}>
            {emergencySystem.toUpperCase()}
          </div>
          <div className="stat-label">Emergency System</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">👥</div>
          <div className="stat-num">{contacts.length}</div>
          <div className="stat-label">Emergency Contacts</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📍</div>
          <div className="stat-num" style={{ fontSize: '14px', color: 'var(--text-secondary)' }} id="stat-gps">
            {currentGPS ? (
              <span style={{ color: 'var(--safe-color)' }}>Active ✓</span>
            ) : "Locating…"}
          </div>
          <div className="stat-label">GPS Status</div>
        </div>
      </div>

      {/* ── Bottom Grid ────────────────────────────────────── */}
      <div className="bottom-grid animate-up delay-3">
        {/* Contacts Panel */}
        <div className="card">
          <div className="card-title">
            <i className="ti ti-phone-call" style={{ fontSize: '15px' }}></i>
            Emergency Contacts
          </div>
          <div id="contacts-list">
            {contacts.length === 0 ? (
              <div className="empty-state">No emergency contacts added yet.</div>
            ) : (
              contacts.map((c, i) => (
                <div key={i} className="contact-item">
                  <div className="contact-avatar">{initials(c.name)}</div>
                  <div className="contact-info">
                    <div className="contact-name">{c.name}</div>
                    <div className="contact-num">{c.number}</div>
                  </div>
                  <button className="contact-del" onClick={() => removeContact(i)} aria-label={`Remove ${c.name}`}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="add-contact-form">
            <input className="input-field" type="text" ref={newNameRef} placeholder="Name" style={{ maxWidth: '120px' }} />
            <input className="input-field" type="tel" ref={newNumberRef} placeholder="+91XXXXXXXXXX" 
                   onKeyDown={(e) => e.key === 'Enter' && addContact()} />
            <button className="btn btn-accent btn-sm" onClick={addContact}>
              <i className="ti ti-plus"></i> Add
            </button>
          </div>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
            Include country code · e.g. +919876543210
          </p>
        </div>

        {/* GPS + Log Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* GPS Card */}
          <div className="card">
            <div className="card-title">
              <i className="ti ti-map-pin" style={{ fontSize: '15px' }}></i>
              Live GPS Location
            </div>
            <div className="gps-display">
              <i className="ti ti-location" style={{ fontSize: '15px', opacity: 0.5 }}></i>
              <span id="gps-val">
                {currentGPS ? (
                  <>
                    <span className="gps-coord">{currentGPS.lat}</span>
                    <span style={{ opacity: 0.4 }}>,</span>
                    <span className="gps-coord">{currentGPS.lng}</span>
                    <span style={{ fontSize: '11px', opacity: 0.5, marginLeft: '6px' }}>±{currentGPS.accuracy}m</span>
                  </>
                ) : (
                  <span style={{ opacity: 0.5 }}>Acquiring signal…</span>
                )}
              </span>
              <button className="gps-refresh" onClick={refreshGPS} title="Refresh GPS" aria-label="Refresh GPS">
                <i className="ti ti-refresh"></i>
              </button>
            </div>
            <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
              <button className="btn btn-sm" onClick={openGoogleMaps} id="maps-btn" style={{ opacity: currentGPS ? 1 : 0.5, pointerEvents: currentGPS ? 'auto' : 'none' }}>
                <i className="ti ti-map"></i> Open Maps
              </button>
            </div>
          </div>

          {/* Activity Log */}
          <div className="card" style={{ flex: 1 }}>
            <div className="card-title">
              <i className="ti ti-activity" style={{ fontSize: '15px' }}></i>
              Activity Log
            </div>
            <div id="log-list">
              {activityLog.length === 0 ? (
                <div className="empty-state">No activity yet.</div>
              ) : (
                activityLog.map((l, i) => (
                  <div key={i} className="log-item">
                    <span className={`log-dot ${l.type}`}></span>
                    <span className="log-text">{l.text}</span>
                    <span className="log-time">{l.time}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Toast Container */}
      <div id="toast-container" style={{
        position: 'fixed', bottom: '24px', right: '24px',
        display: 'flex', flexDirection: 'column', gap: '8px',
        zIndex: 9999, pointerEvents: 'none'
      }}>
        {toasts.map(t => (
          <Toast key={t.id} message={t.message} type={t.type} />
        ))}
      </div>
    </div>
  );
}

export default App;
