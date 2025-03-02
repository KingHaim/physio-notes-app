import React, { useState, useRef } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const sessionIdRef = useRef(null);

  // Configure Axios for PythonAnywhere backend
  const apiClient = axios.create({
    baseURL: 'https://trxck.pythonanywhere.com', // Your PythonAnywhere URL
    timeout: 60000, // 60-second timeout for free-tier limits
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  // Add retry logic and CORS error handling for network failures
  apiClient.interceptors.response.use(
    response => response,
    async error => {
      const config = error.config || {};
      if (!config.retry) config.retry = 3; // Retry up to 3 times
      if (config.retry > 0 && (error.code === 'ECONNABORTED' || error.message.includes('timeout'))) {
        config.retry -= 1;
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
        return apiClient(config);
      }
      setError(`Network error: ${error.message} (Status: ${error.response?.status || 'Unknown'})`);
      return Promise.reject(error);
    }
  );

  const startRecording = async () => {
    setError('');
    setTranscript('');
    setNotes('');

    try {
      // Handle CORS preflight or server errors
      const response = await apiClient.post('/start_recording', { language: 'en-US' });
      sessionIdRef.current = response.data.session_id;
      console.log('Session started:', sessionIdRef.current);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('Microphone access granted');

      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      console.log('Selected MIME type:', mimeType);

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = event => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          console.log('Audio chunk size:', event.data.size);
        }
      };

      recorder.onstop = async () => {
        console.log('Recorder stopped, chunks:', audioChunksRef.current.length);
        if (audioChunksRef.current.length === 0) {
          setError('No audio data recorded');
          cleanupStream(stream);
          return;
        }

        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        let wavBlob;
        try {
          wavBlob = await convertToWav(audioBlob);
          console.log('WAV Blob size:', wavBlob.size);
        } catch (e) {
          setError('Audio conversion failed: ' + e.message);
          cleanupStream(stream);
          return;
        }

        if (!(wavBlob instanceof Blob) || wavBlob.size === 0) {
          setError('Invalid WAV blob, using fallback');
          wavBlob = createSilenceWavBlob();
          if (!(wavBlob instanceof Blob) || wavBlob.size === 0) {
            setError('Fallback WAV blob failed');
            cleanupStream(stream);
            return;
          }
        }

        await stopRecording(wavBlob);
        cleanupStream(stream);
      };

      recorder.onerror = e => {
        setError('Recording error: ' + e.error?.message || 'Unknown error');
        cleanupStream(stream);
      };

      recorder.start();
      setIsRecording(true);
      console.log('Recording started');
    } catch (e) {
      setError('Failed to start recording: ' + (e.response?.data?.error || e.message || 'Network or server error'));
      console.error('Start recording error:', e);
    }
  };

  const cleanupStream = (stream) => {
    stream.getTracks().forEach(track => track.stop());
    setIsRecording(false);
    mediaRecorderRef.current = null;
  };

  const convertToWav = async (blob) => {
    if (!(blob instanceof Blob) || blob.size === 0) {
      throw new Error('Invalid input blob');
    }
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const offlineContext = new OfflineAudioContext(1, audioBuffer.length * 16000 / audioBuffer.sampleRate, 16000);
    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start();
    const renderedBuffer = await offlineContext.startRendering();
    return new Blob([bufferToWav(renderedBuffer)], { type: 'audio/wav' });
  };

  const bufferToWav = (buffer) => {
    const numChannels = 1;
    const sampleRate = 16000;
    const bytesPerSample = 2;
    const dataLength = buffer.length * bytesPerSample;
    const arrayBuffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(arrayBuffer);
    let offset = 0;
    const writeString = (str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset++, str.charCodeAt(i));
    };
    writeString('RIFF');
    view.setUint32(offset, 36 + dataLength, true); offset += 4;
    writeString('WAVE');
    writeString('fmt ');
    view.setUint32(offset, 16, true); offset += 4;
    view.setUint16(offset, 1, true); offset += 2; // PCM
    view.setUint16(offset, numChannels, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4;
    view.setUint32(offset, sampleRate * numChannels * bytesPerSample, true); offset += 4;
    view.setUint16(offset, numChannels * bytesPerSample, true); offset += 2;
    view.setUint16(offset, 16, true); offset += 2; // Bits per sample
    writeString('data');
    view.setUint32(offset, dataLength, true); offset += 4;
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < channelData.length; i++) {
      view.setInt16(offset, channelData[i] * 32767, true);
      offset += 2;
    }
    return arrayBuffer;
  };

  const createSilenceWavBlob = () => {
    const numChannels = 1;
    const sampleRate = 16000;
    const bitsPerSample = 16;
    const seconds = 1; // 1 second of silence
    const numSamples = sampleRate * seconds;
    const bytesPerSample = bitsPerSample / 8;
    const dataLength = numSamples * bytesPerSample;
    const arrayBuffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(arrayBuffer);
    let offset = 0;

    // WAV header
    writeString('RIFF', view, offset); offset += 4;
    view.setUint32(offset, 36 + dataLength, true); offset += 4;
    writeString('WAVE', view, offset); offset += 4;
    writeString('fmt ', view, offset); offset += 4;
    view.setUint32(offset, 16, true); offset += 4; // Subchunk1Size
    view.setUint16(offset, 1, true); offset += 2;  // AudioFormat (PCM)
    view.setUint16(offset, numChannels, true); offset += 2; // NumChannels
    view.setUint32(offset, sampleRate, true); offset += 4; // SampleRate
    view.setUint32(offset, sampleRate * numChannels * bytesPerSample, true); offset += 4; // ByteRate
    view.setUint16(offset, numChannels * bytesPerSample, true); offset += 2; // BlockAlign
    view.setUint16(offset, bitsPerSample, true); offset += 2; // BitsPerSample
    writeString('data', view, offset); offset += 4;
    view.setUint32(offset, dataLength, true); offset += 4;

    // Silent data (zeros)
    for (let i = 0; i < numSamples; i++) {
      view.setInt16(offset, 0, true); // Silence
      offset += 2;
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  };

  const stopRecording = async (wavBlob) => {
    try {
      const formData = new FormData();
      formData.append('session_id', sessionIdRef.current);
      formData.append('audio', wavBlob, 'recording.wav');
      const response = await apiClient.post('/stop_recording', formData);
      setTranscript(response.data.transcription || 'No transcript available');
      setNotes(response.data.notes || 'No notes generated');
    } catch (e) {
      setError('Failed to stop recording: ' + (e.response?.data?.error || e.message || 'Network error'));
      console.error('Stop error:', e);
    }
  };

  return (
    <div className="app-container">
      <h1>Physiotherapy Notes Generator</h1>
      {error && <p style={{ color: 'red', fontWeight: 'bold' }}>{error}</p>}
      <button
        onClick={isRecording ? () => mediaRecorderRef.current?.stop() : startRecording}
        style={{
          backgroundColor: isRecording ? '#f44336' : '#4CAF50',
          color: 'white',
          padding: '10px 20px',
          border: 'none',
          borderRadius: '5px',
          cursor: 'pointer',
          margin: '10px 0',
        }}
      >
        {isRecording ? 'Stop Recording' : 'Start Recording'}
      </button>
      {transcript && (
        <div>
          <h3>Transcript</h3>
          <p>{transcript}</p>
        </div>
      )}
      {notes && (
        <div>
          <h3>Generated Notes</h3>
          <p>{notes}</p>
        </div>
      )}
    </div>
  );
}

export default App;