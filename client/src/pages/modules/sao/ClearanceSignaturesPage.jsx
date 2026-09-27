import { PenTool } from 'lucide-react';

export default function ClearanceSignaturesPage() {
  return (
    <div className="space-y-6 p-6">
      <section className="flex flex-col gap-4 rounded-lg border border-[#0F2F62] bg-[#0F2F62] p-6 text-white">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#16C7F3]">Organization Setup</p>
          <h1 className="mt-1 text-2xl font-black">My Clearance Signatures</h1>
          <p className="mt-1 text-sm text-slate-200">Track and request digital signatures for your organization's active clearance forms.</p>
        </div>
      </section>

      <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-[#DDE7EF] bg-slate-50">
        <div className="text-center max-w-md p-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white border border-[#DDE7EF] shadow-sm mb-4 text-[#0B8ED0]">
            <PenTool size={28} />
          </div>
          <h3 className="text-lg font-bold text-[#0F172A]">Select a Clearance Cycle</h3>
          <p className="mt-2 text-sm text-slate-500 leading-relaxed">
            Please select an active clearance cycle from the SAO dashboard to view required signatories and current progress.
          </p>
        </div>
      </div>
    </div>
  );
}
