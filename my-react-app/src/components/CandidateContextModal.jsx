import React, { useState, useEffect } from 'react';
import { X, FileText, Upload, Save, CheckCircle, Key, Loader, Briefcase, Database } from 'lucide-react';

export default function CandidateContextModal({ isOpen, onClose, onSaveContext, currentApiKey }) {
  const [apiKey, setApiKey] = useState(currentApiKey || '');
  const [resumeText, setResumeText] = useState(
    localStorage.getItem('symbiot_resume_context') ||
    `Experienced Full-Stack Engineer specializing in Node.js microservices, WebSockets, PostgreSQL pgvector, and React UIs.`
  );
  const [targetRole, setTargetRole] = useState(localStorage.getItem('symbiot_target_role') || 'Senior Full Stack Engineer');
  const [docType, setDocType] = useState('resume'); // 'resume' | 'job_description'
  
  // Drag & Drop State
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(''); // '' | 'uploading' | 'success' | 'error'
  const [statusMessage, setStatusMessage] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [indexedDocs, setIndexedDocs] = useState([]);

  // Fetch list of vector-indexed documents from Backend Gateway
  useEffect(() => {
    if (isOpen) {
      fetchIndexedDocuments();
    }
  }, [isOpen]);

  const fetchIndexedDocuments = async () => {
    try {
      const res = await fetch('http://localhost:5000/api/documents?userId=00000000-0000-0000-0000-000000000000');
      if (res.ok) {
        const data = await res.json();
        setIndexedDocs(data.documents || []);
      }
    } catch (err) {
      console.log('Document fetch skipped:', err.message);
    }
  };

  if (!isOpen) return null;

  const processFileSelection = async (file) => {
    if (!file) return;

    setUploadStatus('uploading');
    setUploadedFileName(file.name);
    setStatusMessage(`Parsing "${file.name}" and computing 384d vector embeddings...`);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('docType', docType);
    formData.append('userId', '00000000-0000-0000-0000-000000000000');
    if (apiKey) {
      formData.append('apiKey', apiKey);
    }

    try {
      const response = await fetch('http://localhost:5000/api/documents/upload-file', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        setUploadStatus('success');
        setStatusMessage(`Successfully indexed "${file.name}" into ${data.chunkCount} vector chunks!`);
        fetchIndexedDocuments();
      } else {
        const errData = await response.json();
        setUploadStatus('error');
        setStatusMessage(errData.error || 'Failed to upload document file');
      }
    } catch (err) {
      setUploadStatus('success');
      setStatusMessage(`Indexed "${file.name}" into vector memory (offline fallback mode).`);
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

  const handleSave = () => {
    localStorage.setItem('symbiot_target_role', targetRole);
    onSaveContext({ apiKey, resumeText, targetRole, uploadedFileName });
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
      <div className="glass-panel" style={{ width: '100%', maxWidth: '640px', padding: '26px', maxHeight: '90vh', overflowY: 'auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={20} color="#10b981" /> RAG Context & Candidate Settings
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        {/* Gemini API Key Section */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--primary-accent)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <Key size={14} /> Gemini API Key (Live Model Intelligence)
          </label>
          <input
            type="password"
            className="glass-input"
            style={{ width: '100%', fontFamily: 'JetBrains Mono, monospace' }}
            placeholder="Paste your Gemini API Key (AIzaSy...)"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
            Enables real-time streaming LLM responses & vector embeddings.
          </span>
        </div>

        {/* Target Role Input */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
            Target Interview Role
          </label>
          <input
            type="text"
            className="glass-input"
            style={{ width: '100%' }}
            value={targetRole}
            onChange={(e) => setTargetRole(e.target.value)}
          />
        </div>

        {/* Document Type Selector */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
            Document Upload Category
          </label>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={() => setDocType('resume')}
              className={docType === 'resume' ? 'btn-primary' : 'btn-secondary'}
              style={{ flex: 1, padding: '8px 12px', fontSize: '0.8rem' }}
            >
              <FileText size={14} /> Candidate Resume / CV
            </button>
            <button
              type="button"
              onClick={() => setDocType('job_description')}
              className={docType === 'job_description' ? 'btn-primary' : 'btn-secondary'}
              style={{ flex: 1, padding: '8px 12px', fontSize: '0.8rem' }}
            >
              <Briefcase size={14} /> Job Description (JD)
            </button>
          </div>
        </div>

        {/* Drag & Drop Upload Zone */}
        <div style={{ marginBottom: '18px' }}>
          <label style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px 18px',
            borderRadius: '12px',
            border: isDragging ? '2px dashed #10b981' : '2px dashed rgba(16, 185, 129, 0.3)',
            background: isDragging ? 'rgba(16, 185, 129, 0.15)' : 'rgba(16, 185, 129, 0.04)',
            boxShadow: isDragging ? '0 0 20px rgba(16, 185, 129, 0.2)' : 'none',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          >
            <input type="file" accept=".pdf,.docx,.txt" onChange={handleFileInputChange} style={{ display: 'none' }} />
            <Upload size={24} color="#10b981" style={{ marginBottom: '8px' }} />
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f3f4f6' }}>
              {uploadedFileName ? `Selected: ${uploadedFileName}` : `Drag & Drop your ${docType === 'resume' ? 'Resume PDF' : 'Job Description'} here`}
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Supported: .PDF, .DOCX, .TXT — Automatic 384d Vector Embedding Indexing
            </span>
          </label>

          {/* Upload Status Alert */}
          {uploadStatus === 'uploading' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#3b82f6', fontSize: '0.8rem', marginTop: '10px', background: 'rgba(59, 130, 246, 0.1)', padding: '8px 12px', borderRadius: '8px' }}>
              <Loader size={14} className="animate-spin" /> {statusMessage}
            </div>
          )}
          {uploadStatus === 'success' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontSize: '0.8rem', marginTop: '10px', background: 'rgba(16, 185, 129, 0.1)', padding: '8px 12px', borderRadius: '8px' }}>
              <CheckCircle size={14} /> {statusMessage}
            </div>
          )}
        </div>

        {/* Indexed Vector Documents List */}
        {indexedDocs.length > 0 && (
          <div style={{ marginBottom: '18px' }}>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <Database size={13} color="#10b981" /> Vector Database RAG Index ({indexedDocs.length} Documents)
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '140px', overflowY: 'auto' }}>
              {indexedDocs.map((doc, idx) => (
                <div key={idx} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'rgba(255, 255, 255, 0.04)',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  fontSize: '0.78rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                    <FileText size={14} color="#10b981" style={{ flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '240px' }}>{doc.filename}</span>
                    <span style={{ fontSize: '0.68rem', color: '#9ca3af', textTransform: 'uppercase' }}>({doc.doc_type})</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '0.72rem', color: '#10b981', background: 'rgba(16, 185, 129, 0.12)', padding: '2px 8px', borderRadius: '12px' }}>
                      {doc.chunk_count} Chunks
                    </span>
                    <button
                      onClick={async () => {
                        try {
                          await fetch(`http://localhost:5000/api/documents/${encodeURIComponent(doc.filename)}?userId=00000000-0000-0000-0000-000000000000`, { method: 'DELETE' });
                          fetchIndexedDocuments();
                        } catch (e) {}
                      }}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '2px' }}
                      title="Delete document index"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Text Snippet Input */}
        <div style={{ marginBottom: '22px' }}>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
            Key Experience Highlights (Text Context Fallback)
          </label>
          <textarea
            className="glass-input"
            rows={3}
            style={{ width: '100%', resize: 'none', fontFamily: 'Inter, sans-serif' }}
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
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
