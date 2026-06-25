import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { Monitor, Globe, PlayCircle, Wrench, Mic, Send } from "lucide-react";
import "./styles.css";

function getDynamicGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning, Boss. Systems are operational.";
    if (hour < 18) return "Good afternoon, Boss. How may I assist you?";
    return "Good evening, Boss. Systems are online.";
}

function App() {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const hasStartedChat = messages.length > 1;
  
  // Security State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const CORRECT_PIN = import.meta.env.VITE_JARVIS_PIN || "1234";

  const handlePinSubmit = (e) => {
      e.preventDefault();
      if (pinInput === CORRECT_PIN) {
          setIsAuthenticated(true);
      } else {
          setPinError(true);
          setPinInput("");
          setTimeout(() => setPinError(false), 2000);
      }
  };
  
  // Voice State
  const [isMicActive, setIsMicActive] = useState(false); 
  const [isListening, setIsListening] = useState(false); 
  const [isSpeaking, setIsSpeaking] = useState(false);   
  const wasLastInputVoice = useRef(false); // SMART VOICE TOGGLE
  const draftIsFromVoiceRef = useRef(false); // Tracks if current draft was dictated
  
  // HUD State
  const [timeStr, setTimeStr] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [netSpeed, setNetSpeed] = useState({ up: 98.7, down: 120.4 });
  
  const transcriptRef = useRef(null);
  const abortControllerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  // HUD Clocks & Telemetry
  useEffect(() => {
      const timer = setInterval(() => {
          const now = new Date();
          setTimeStr(now.toLocaleTimeString('en-US', { hour12: false }));
          setDateStr(now.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }).toUpperCase());
          
          if (Math.random() > 0.7) {
              setNetSpeed({
                  up: (90 + Math.random() * 20).toFixed(1),
                  down: (110 + Math.random() * 30).toFixed(1)
              });
          }
      }, 1000);
      return () => clearInterval(timer);
  }, []);

  // Startup Greeting
  useEffect(() => {
      const greeting = getDynamicGreeting();
      setMessages([{ role: "assistant", content: greeting }]);
      speakText(greeting);
  }, []);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  // --- Premium Voice Tweaks ---
  const speakText = useCallback((text) => {
      if (!window.speechSynthesis) return;
      
      window.speechSynthesis.cancel();
      
      const utterance = new SpeechSynthesisUtterance(text);
      
      // Try to find a deep, professional voice. 
      const voices = window.speechSynthesis.getVoices();
      const preferredVoices = voices.filter(v => 
          v.name.includes("Google UK English Male") || 
          v.name.includes("Microsoft David") || 
          v.name.includes("Mark") ||
          v.name.includes("English (Great Britain)")
      );
      
      if (preferredVoices.length > 0) {
          utterance.voice = preferredVoices[0];
      }
      
      // Tweaks for a more JARVIS-like, composed tone (if OS supports it)
      utterance.rate = 1.0;
      utterance.pitch = 0.8; 
      
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      
      window.speechSynthesis.speak(utterance);
  }, []);

  // Custom MediaRecorder Audio Engine
  useEffect(() => {
      if (isMicActive) {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
              setDraft("ERROR: BROWSER DOES NOT SUPPORT AUDIO RECORDING.");
              setIsMicActive(false);
              return;
          }
          
          setDraft("INITIALIZING MIC...");
          navigator.mediaDevices.getUserMedia({ audio: true })
              .then(stream => {
                  const recorder = new MediaRecorder(stream);
                  mediaRecorderRef.current = recorder;
                  audioChunksRef.current = [];
                  
                  recorder.ondataavailable = e => {
                      if (e.data.size > 0) audioChunksRef.current.push(e.data);
                  };
                  
                  recorder.onstop = async () => {
                      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                      const reader = new FileReader();
                      reader.readAsDataURL(blob);
                      reader.onloadend = async () => {
                          const base64data = reader.result.split(',')[1];
                          try {
                              setDraft("TRANSCRIBING AUDIO...");
                              const res = await fetch("/api/transcribe", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ audioBase64: base64data, mimeType: blob.type })
                              });
                              const data = await res.json();
                              if (data.text) {
                                  setDraft(data.text.trim());
                                  draftIsFromVoiceRef.current = true;
                              } else {
                                  setDraft("ERROR: TRANSCRIPTION FAILED.");
                              }
                          } catch (err) {
                              setDraft("ERROR: BACKEND NETWORK FAULT.");
                          }
                      };
                  };
                  
                  recorder.start();
                  setIsListening(true);
                  setDraft("RECORDING... CLICK MIC AGAIN TO STOP.");
              })
              .catch(err => {
                  console.error(err);
                  setDraft("ERROR: MIC PERMISSION DENIED IN BROWSER.");
                  setIsMicActive(false);
                  setIsListening(false);
              });
      } else {
          // Stop recording
          if (mediaRecorderRef.current && isListening) {
              mediaRecorderRef.current.stop();
              mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
              setIsListening(false);
          }
      }
      
      // Cleanup on unmount
      return () => {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
              mediaRecorderRef.current.stop();
              mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
          }
      };
  }, [isMicActive]);


  // --- Chat Logic ---
  async function sendMessage(content = draft) {
    const trimmed = content.trim();
    if (!trimmed || busy) return;

    window.speechSynthesis?.cancel();

    const nextMessages = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setDraft("");
    setBusy(true);

    setMessages(current => [...current, { role: "assistant", content: "" }]);

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages.slice(-12) }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
          throw new Error(`Server status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      
      let done = false;
      let fullResponseText = "";
      let buffer = "";

      while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          
          if (value) {
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop(); // Keep the last incomplete line in the buffer
              
              for (const line of lines) {
                  if (line.trim() === '') continue;
                  if (line.startsWith('data: ')) {
                      const dataStr = line.substring(6);
                      if (dataStr === '[DONE]') {
                          done = true;
                          break;
                      }
                      
                      try {
                          const parsed = JSON.parse(dataStr);
                          if (parsed.error) {
                              setMessages(current => {
                                  const updated = [...current];
                                  updated[updated.length - 1] = { 
                                      role: "assistant", 
                                      content: `[SYSTEM FAULT: ${typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error)}]`,
                                      isError: true 
                                  };
                                  return updated;
                              });
                              done = true;
                              break;
                          }
                          if (parsed.memorySaved) {
                              setMessages(current => {
                                  const updated = [...current];
                                  updated[updated.length - 1] = { 
                                      role: "assistant", 
                                      content: updated[updated.length - 1].content + "\n\n[ DATABASE UPDATED ]" 
                                  };
                                  return updated;
                              });
                              continue;
                          }
                          if (parsed.text) {
                              fullResponseText += parsed.text;
                              setMessages(current => {
                                  const updated = [...current];
                                  updated[updated.length - 1] = { role: "assistant", content: fullResponseText };
                                  return updated;
                              });
                          }
                      } catch (e) {
                          console.error("JSON parse error on chunk:", dataStr, e);
                      }
                  }
              }
          }
      }
      
      // SMART VOICE: Only speak out loud if the user's last command was via microphone
      if (wasLastInputVoice.current && fullResponseText) {
          speakText(fullResponseText);
      }

    } catch (requestError) {
      console.error(requestError);
      setMessages(current => {
          const updated = [...current];
          if (updated[updated.length-1].content === "") {
              updated[updated.length-1].content = requestError.message || "I am currently experiencing connection difficulties. Please try again.";
          }
          return updated;
      });
      if (wasLastInputVoice.current) {
          speakText("I am currently experiencing connection difficulties.");
      }
    } finally {
      setBusy(false);
      abortControllerRef.current = null;
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    wasLastInputVoice.current = draftIsFromVoiceRef.current;
    draftIsFromVoiceRef.current = false; // Reset for next message
    setIsMicActive(false); // Turn off mic when sending
    sendMessage();
  }

  // Pre-load voices
  useEffect(() => {
      if (window.speechSynthesis) {
          window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
      }
  }, []);

  if (!isAuthenticated) {
      return (
          <div className="hud-container lock-screen">
              <div className="lock-box">
                  <div className="lock-icon" style={{color: pinError ? 'red' : 'var(--cyan)'}}><Wrench size={48} /></div>
                  <h2 style={{color: pinError ? 'red' : 'var(--cyan)'}}>RESTRICTED AREA</h2>
                  <p>PLEASE ENTER SECURITY PIN</p>
                  <form onSubmit={handlePinSubmit}>
                      <input 
                          type="password" 
                          value={pinInput} 
                          onChange={e => setPinInput(e.target.value)} 
                          className={pinError ? "pin-input error" : "pin-input"}
                          autoFocus
                      />
                  </form>
                  {pinError && <div className="error-text">ACCESS DENIED</div>}
              </div>
          </div>
      );
  }

  return (
    <div className="hud-container">
      
      {/* Telemetry Corners */}
      <div className="corner corner-tl">
        JARVIS OS<br/><span className="highlight">v2.3.0</span>
      </div>
      <div className="corner corner-tr">
        {dateStr}<br/><span className="highlight">{timeStr}</span>
      </div>
      <div className="corner corner-bl">
        ↓ {netSpeed.down} KBPS<br/>↑ {netSpeed.up} KBPS
      </div>
      <div className="corner corner-br">
        <span className="highlight">23°</span><br/>PARTLY CLOUDY
      </div>

      {/* Left Menu */}
      <div className="side-menu">
        <div className="menu-item" onClick={() => sendMessage("Give me a system diagnostic report.")}><Monitor size={20}/> SYSTEM</div>
        <div className="menu-item" onClick={() => sendMessage("Run a network speed simulation.")}><Globe size={20}/> NETWORK</div>
        <div className="menu-item" onClick={() => sendMessage("Analyze current media protocols.")}><PlayCircle size={20}/> MEDIA</div>
        <div className="menu-item" onClick={() => sendMessage("List available tools and capabilities.")}><Wrench size={20}/> TOOLS</div>
      </div>

      {/* Center Arc Reactor */}
      <div className={`reactor-container ${hasStartedChat ? 'chat-active' : ''}`}>
        <div className="ring ring-1"></div>
        <div className="ring ring-2"></div>
        <div className="ring ring-3"></div>
        <div className="ring ring-4"></div>
        <div className="reactor-core">JARVIS</div>
      </div>

      {/* Center Chat Bracket */}
      <div className={`chat-bracket ${hasStartedChat ? 'chat-active' : ''}`}>
        <div className="transcript" ref={transcriptRef}>
          {messages.map((message, index) => (
            <div className={`message ${message.role}`} key={index}>
              {message.role === "assistant" && <span style={{marginRight: '8px'}}>&gt;</span>}
              {message.content.toUpperCase()}
              {busy && message.role === "assistant" && index === messages.length - 1 && (
                <span className="cursor-blink">_</span>
              )}
            </div>
          ))}
          {busy && messages[messages.length-1]?.role !== "assistant" && (
            <div className="message assistant">
              &gt; <span className="cursor-blink">_</span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Voice Controls & Input */}
      <div className="bottom-controls">
        <div className="status-text" style={{ marginBottom: '-5px' }}>
            {isMicActive ? (isListening ? "LISTENING..." : "PROCESSING...") : "AWAITING COMMAND"}
        </div>
        
        <form onSubmit={handleSubmit} className="input-row">
            <div 
                className={`mic-btn ${isMicActive ? 'active' : ''}`} 
                onClick={() => setIsMicActive(!isMicActive)}
                title="Toggle Voice Input"
            >
                <Mic size={24} />
            </div>
            
            <input 
                className="composer-input" 
                type="text" 
                placeholder="TYPE HERE, OR CLICK MIC TO SPEAK"
                value={draft}
                onChange={e => {
                    setDraft(e.target.value);
                    draftIsFromVoiceRef.current = false; // manual typing overrides dictation
                }}
                disabled={isMicActive}
            />
            
            <button type="submit" className="send-btn" disabled={!draft.trim() || busy} title="Send Message">
                <Send size={24} />
            </button>
        </form>
      </div>

    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
