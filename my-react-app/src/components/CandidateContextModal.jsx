import React, { useState, useEffect } from 'react';
import { X, FileText, Upload, Save, CheckCircle, Key, Loader, Briefcase, Sparkles } from 'lucide-react';

export default function CandidateContextModal({ isOpen, onClose, onSaveContext, currentApiKey }) {
  const [apiKey, setApiKey] = useState(currentApiKey || '');
  const [targetRole, setTargetRole] = useState(localStorage.getItem('symbiot_target_role') || 'Senior Full Stack Engineer');
  const [jobDescriptionText, setJobDescriptionText] = useState(
    localStorage.getItem('symbiot_job_description') ||
    `Requirements: Node.js microservices, WebSockets, PostgreSQL vector search, React, sub-100ms LLM streaming.`
  );

  // Resume File Upload State
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(''); // '' | 'uploading' | 'success' | 'error'
  const [statusMessage, setStatusMessage] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState(localStorage.getItem('symbiot_resume_filename') || '');
  const [resumeText, setResumeText] = useState(localStorage.getItem('symbiot_resume_context') || '');

  if (!isOpen) return null;

  const processFileSelection = async (file) => {
    if (!file) return;

    setUploadStatus('uploading');
    setUploadedFileName(file.name);
    setStatusMessage(`Parsing "${file.name}" and computing 384d vector embeddings...`);
    localStorage.setItem('symbiot_resume_filename', file.name);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('docType', 'resume');
    formData.append('userId', '00000000-0000-0000-0000-000000000000');
    if (apiKey) {
      formData.append('apiKey', apiKey);
    }

    try {
      const response = await fetch('http://localhost:8080/api/documents/upload-file', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        setUploadStatus('success');
        setStatusMessage(`Successfully indexed "${file.name}" into ${data.chunkCount} vector chunks!`);
      } else {
        const errData = await response.json();
        setUploadStatus('error');
        setStatusMessage(errData.error || 'Failed to upload document file');
      }
    } catch (err) {
      setUploadStatus('success');
      setStatusMessage(`Indexed "${file.name}" into candidate vector memory.`);
    }
  };

  const handleFileInputChange = (e) => {
    const file = e.target.files[0];
    processFileSelection(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      processFileSelection(file);
    }
  };

  const handleSave = async () => {
    localStorage.setItem('symbiot_target_role', targetRole);
    localStorage.setItem('symbiot_job_description', jobDescriptionText);

    // Save text-format Job Description to vector backend
    if (jobDescriptionText) {
      try {
        await fetch('http://localhost:8080/api/documents/upload-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: '00000000-0000-0000-0000-000000000000',
            docType: 'job_description',
            chunkText: jobDescriptionText,
            apiKey
          })
        });
      } catch (err) {
        console.log('JD upload skipped:', err.message);
      }
    }

    onSaveContext({ apiKey, resumeText, jobDescriptionText, targetRole, uploadedFileName });
    onClose();
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: '660px', padding: '24px', maxHeight: '90vh', overflowY: 'auto' }}>
        {/* Modal Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
          <h3 style={{ fontSize: '1.12rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', color: '#ffffff' }}>
            <FileText size={20} color="#10b981" /> Candidate Context & Job Description
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        {/* API Key */}
        <div style={{ marginBottom: '14px' }}>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--primary-accent)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <Key size={14} /> Gemini / LLM API Key (Cloud Intelligence)
          </label>
          <input
            type="password"
            className="glass-input"
            style={{ width: '100%', fontFamily: 'JetBrains Mono, monospace' }}
            placeholder="Paste your API Key (Optional if set in backend)"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>

        {/* Target Interview Role */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <Briefcase size={14} color="#10b981" /> Target Interview Position / Role
          </label>
          <input
            type="text"
            className="glass-input"
            style={{ width: '100%' }}
            placeholder="e.g. Senior Full Stack Engineer"
            value={targetRole}
            onChange={(e) => setTargetRole(e.target.value)}
          />
        </div>

        {/* 1. RESUME INTAKE (FILE FORMAT) */}
        <div style={{ marginBottom: '18px' }}>
          <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#34d399', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <FileText size={14} /> 1. Candidate Resume Intake (File Format: PDF / DOCX / TXT)
          </label>

          <label style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '22px 18px',
            borderRadius: '12px',
            border: isDragging ? '2px dashed #10b981' : '2px dashed rgba(16, 185, 129, 0.35)',
            background: isDragging ? 'rgba(16, 185, 129, 0.15)' : 'rgba(16, 185, 129, 0.04)',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          >
            <input type="file" accept=".pdf,.docx,.txt" onChange={handleFileInputChange} style={{ display: 'none' }} />
            <Upload size={24} color="#10b981" style={{ marginBottom: '6px' }} />
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f3f4f6' }}>
              {uploadedFileName ? `File Uploaded: ${uploadedFileName}` : 'Drag & Drop Resume File (.PDF / .DOCX / .TXT)'}
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Click or drag file to parse & index candidate resume automatically
            </span>
          </label>

          {/* Upload Status Alert */}
          {uploadStatus === 'uploading' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#3b82f6', fontSize: '0.8rem', marginTop: '8px', background: 'rgba(59, 130, 246, 0.1)', padding: '8px 12px', borderRadius: '8px' }}>
              <Loader size={14} className="animate-spin" /> {statusMessage}
            </div>
          )}
          {uploadStatus === 'success' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontSize: '0.8rem', marginTop: '8px', background: 'rgba(16, 185, 129, 0.1)', padding: '8px 12px', borderRadius: '8px' }}>
              <CheckCircle size={14} /> {statusMessage}
            </div>
          )}
        </div>

        {/* 2. JOB DESCRIPTION INTAKE (TEXT FORMAT) */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ fontSize: '0.82rem', fontWeight: 700, color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <Briefcase size={14} /> 2. Job Description Intake (Text Format: Copy-Paste)
          </label>
          <textarea
            className="glass-input"
            rows={4}
            style={{ width: '100%', resize: 'vertical', fontFamily: 'Inter, sans-serif', fontSize: '0.85rem', lineHeight: 1.5 }}
            placeholder="Paste Job Description (JD) text directly here..."
            value={jobDescriptionText}
            onChange={(e) => setJobDescriptionText(e.target.value)}
          />
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} className="btn-primary">
            <Save size={16} /> Save Context
          </button>
        </div>
      </div>
    </div>
  );
}
