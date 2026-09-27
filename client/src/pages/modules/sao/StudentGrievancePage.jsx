import { useState } from 'react';
import { Send, EyeOff, ShieldAlert, Sparkles, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../../../services/api';
import Modal from '../../../components/Modal';

export default function StudentGrievancePage() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  
  // AI Preview State
  const [showAIPreview, setShowAIPreview] = useState(false);
  const [aiClassification, setAiClassification] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  const checkClassification = async (e) => {
    e.preventDefault();
    if (!title || !description) return;
    
    setAnalyzing(true);
    setError('');
    try {
      const res = await api.post('/grievance-classification', { title, description });
      setAiClassification(res.data);
      setShowAIPreview(true);
    } catch (err) {
      // Fallback to direct submission if AI service is unavailable
      handleSubmit(e);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await api.post('/grievances', { 
        title, 
        description, 
        is_anonymous: isAnonymous,
        urgency: aiClassification?.urgency || 'Medium',
        category: aiClassification?.category || 'General'
      });
      setShowAIPreview(false);
      setSubmitted(true);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to submit grievance.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-green-100 bg-white p-8 text-center shadow-lg">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600 mb-6">
            <CheckCircle2 size={32} />
          </div>
          <h2 className="mb-2 text-2xl font-black text-[#0F172A]">Report Submitted</h2>
          <p className="text-sm text-slate-500 leading-relaxed">
            Your grievance has been securely transmitted to the Student Affairs Office. 
            {isAnonymous ? " Your identity has been fully protected." : " We will reach out to you via your school email if more information is needed."}
          </p>
          <button 
            onClick={() => { setSubmitted(false); setTitle(''); setDescription(''); setIsAnonymous(false); setAiClassification(null); }}
            className="mt-8 h-11 w-full rounded-lg border border-[#DDE7EF] font-bold text-slate-600 hover:bg-slate-50 transition"
          >
            Submit Another Report
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-3xl mx-auto">
      <section className="flex flex-col gap-4 rounded-lg border border-[#0F2F62] bg-[#0F2F62] p-6 text-white">
        <div className="flex items-center gap-3">
          <ShieldAlert size={28} className="text-[#16C7F3]" />
          <div>
            <h1 className="text-xl font-black">Submit a Grievance</h1>
            <p className="text-xs text-slate-200">Securely report issues or concerns to the Student Affairs Office.</p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 flex items-start gap-3 text-sm font-medium text-red-700">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <div className="rounded-xl border border-[#DDE7EF] bg-white p-6 shadow-sm">
        <form onSubmit={checkClassification} className="space-y-5">
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-[#0F172A]">What is the issue about? *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="E.g. Broken AC in Room 402"
              className="h-11 w-full rounded-lg border border-[#DDE7EF] px-4 text-sm focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 outline-none transition"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-[#0F172A]">Detailed Description *</label>
            <textarea
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder="Please provide as much detail as possible..."
              className="w-full resize-none rounded-lg border border-[#DDE7EF] p-4 text-sm focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 outline-none transition"
            />
          </div>
          
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <div className="relative flex items-center pt-0.5">
                <input
                  type="checkbox"
                  checked={isAnonymous}
                  onChange={(e) => setIsAnonymous(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#0B8ED0] focus:ring-[#0B8ED0]"
                />
              </div>
              <div>
                <span className="flex items-center gap-2 text-sm font-bold text-[#0F172A]">
                  <EyeOff size={16} className="text-slate-500" /> File Anonymously
                </span>
                <p className="mt-1 text-xs text-slate-500">Your name and ID will not be attached to this report. Note that this may limit the SAO's ability to follow up with you directly.</p>
              </div>
            </label>
          </div>

          <button 
            type="submit" 
            disabled={analyzing || submitting || !title || !description} 
            className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#0878B7] font-bold text-white transition hover:bg-[#0F2F62] disabled:opacity-50"
          >
            {analyzing ? (
              'Analyzing Report...'
            ) : (
              <>
                Continue <Send size={16} />
              </>
            )}
          </button>
        </form>
      </div>

      <Modal open={showAIPreview} onClose={() => setShowAIPreview(false)} closeOnBackdrop={!submitting} closeOnEscape={!submitting} maxWidth="max-w-md">
        <div className="rounded-lg bg-white p-6 shadow-xl">
          <div className="flex items-center gap-2 text-[#0878B7] mb-4">
            <Sparkles size={20} />
            <h3 className="text-lg font-black text-[#0F172A]">Review Submission</h3>
          </div>
          
          <div className="space-y-4 mb-6">
            <p className="text-sm text-slate-600">The system has automatically categorized your report to route it to the correct department.</p>
            
            <div className="rounded-lg border border-[#DDE7EF] bg-[#F8FBFD] p-4 space-y-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Assigned Category</p>
                <p className="font-semibold text-[#0F172A]">{aiClassification?.category || 'General'}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Assigned Urgency</p>
                <p className="font-semibold text-[#0F172A]">{aiClassification?.urgency || 'Medium'}</p>
              </div>
            </div>
            <p className="text-xs text-slate-500 italic text-center">Are you ready to submit this report?</p>
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={() => setShowAIPreview(false)} className="h-11 flex-1 rounded-lg border border-[#DDE7EF] text-sm font-bold text-slate-600 hover:bg-[#F8FBFD] transition">Go Back</button>
            <button type="button" onClick={handleSubmit} disabled={submitting} className="h-11 flex-1 rounded-lg bg-[#0878B7] text-sm font-bold text-white hover:bg-[#0F2F62] transition disabled:opacity-50">
              {submitting ? 'Submitting...' : 'Confirm Submit'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
