import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [notes, setNotes] = useState('');
  const [language, setLanguage] = useState('English');
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const sessionIdRef = useRef(`session_${Date.now()}`); // Unique session ID for each recording

  useEffect(() => {
    if (recording) {
      // Start recording on the backend using the Render URL
      axios.post('https://physio-notes-backend.onrender.com/start_recording', {
        language: language === 'English' ? 'en-US' : 'es-ES',
        session_id: sessionIdRef.current,
      })
      .then(() => {
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then(stream => {
            mediaRecorderRef.current = new MediaRecorder(stream);
            mediaRecorderRef.current.ondataavailable = (e) => chunksRef.current.push(e.data);
            mediaRecorderRef.current.start();
          })
          .catch(err => setError(`Error accessing microphone: ${err.message}`));
      })
      .catch(err => setError(`Error starting recording: ${err.message}`));
    } else if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      
      // Stop recording on the backend using the Render URL
      const blob = new Blob(chunksRef.current, { type: 'audio/wav' });
      chunksRef.current = [];
      const formData = new FormData();
      formData.append('audio', blob, 'session.wav');
      formData.append('language', language === 'English' ? 'en-US' : 'es-ES');
      formData.append('session_id', sessionIdRef.current);

      axios.post('https://physio-notes-backend.onrender.com/stop_recording', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then(response => {
        setNotes(response.data.notes);
        setError(null);
      })
      .catch(error => {
        console.error('Error:', error);
        setError('Error generating notes. Check console.');
        setNotes('');
      });
    }
  }, [recording]);

  if (error) {
    return <div className="app">{error}</div>;
  }

  return (
    <div className="app">
      <h1>Physiotherapy Notes Generator</h1>
      <p>Select language and control recording below.</p>
      <select
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
        className="language-select"
      >
        <option value="English">English</option>
        <option value="Spanish">Spanish</option>
      </select>
      <div className="controls">
        <button
          onClick={() => setRecording(true)}
          disabled={recording}
          className="button"
        >
          Initiate Transcription
        </button>
        <button
          onClick={() => setRecording(false)}
          disabled={!recording}
          className="button"
        >
          Stop Transcription
        </button>
      </div>
      <p>{recording ? 'Recording...' : 'Not recording'}</p>
      <textarea
        value={notes}
        readOnly
        placeholder="Notes will appear here after stopping the recording..."
        className="notes-output"
      />
    </div>
  );
}

export default App;