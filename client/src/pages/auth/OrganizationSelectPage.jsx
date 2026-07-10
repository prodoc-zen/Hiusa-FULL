import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, ChevronDown, Search } from 'lucide-react';
import hiusaLogo from '../../assets/Hiusa Logo.png';
import { getOrganizations } from '../../services/organizationService';

const STORAGE_KEY = 'selected_organization';

export default function OrganizationSelectPage() {
  const navigate = useNavigate();
  const [organizations, setOrganizations] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;

    getOrganizations()
      .then((response) => {
        if (!alive) return;
        setOrganizations(response.data);

        const stored = localStorage.getItem(STORAGE_KEY);
        const storedOrganization = stored ? JSON.parse(stored) : null;

        if (storedOrganization?.id && response.data.some((org) => org.id === storedOrganization.id)) {
          setSelectedId(String(storedOrganization.id));
        }
      })
      .catch(() => {
        if (alive) {
          setError('Unable to load student organizations. Please try again.');
        }
      })
      .finally(() => {
        if (alive) {
          setLoading(false);
        }
      });

    return () => {
      alive = false;
    };
  }, []);

  const filteredOrganizations = useMemo(() => {
    const needle = query.trim().toLowerCase();

    if (!needle) {
      return organizations;
    }

    return organizations.filter((organization) => {
      return [organization.name, organization.acronym, organization.college]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle));
    });
  }, [organizations, query]);

  const quickChoices = useMemo(() => organizations.slice(0, 3), [organizations]);
  const selectedOrganization = organizations.find((organization) => String(organization.id) === selectedId);

  function handleContinue(event) {
    event.preventDefault();

    if (!selectedOrganization) {
      setError('Select your student body organization to continue.');
      return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedOrganization));
    navigate('/login');
  }

  return (
    <main className="min-h-screen bg-[#eef6fb] font-sans text-slate-900">
      <header className="border-b border-[#DDE7EF] bg-white">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <img src={hiusaLogo} alt="HIUSA" className="h-10 w-10 object-contain" />
            <span className="text-lg font-black text-[#0B1831]">HIUSA</span>
          </div>
          <span className="hidden text-sm font-semibold text-slate-500 sm:inline">Organization access</span>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:py-12">
        <div className="rounded-lg bg-[#0B1831] p-6 text-white shadow-xl shadow-[#0B1831]/15 sm:p-8 lg:min-h-[500px]">
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/10 text-[#16C7F3]">
                <Building2 size={24} />
              </div>
              <h1 className="mt-6 max-w-[520px] text-3xl font-black leading-tight sm:text-4xl">
                Select your student organization.
              </h1>
              <p className="mt-4 max-w-[460px] text-sm font-medium leading-6 text-slate-300">
                HIUSA opens the right workspace for your school body before you sign in.
              </p>
            </div>

            <div className="mt-10 grid gap-3 text-sm font-semibold text-slate-200 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">
                Organization records, elections, events, merchandise, and announcements stay grouped under the selected workspace.
              </div>
              <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">
                Use your student ID for student accounts, or your email for officer, adviser, and admin access.
              </div>
            </div>
          </div>
        </div>

        <form onSubmit={handleContinue} className="rounded-lg border border-[#DDE7EF] bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-6">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#0B8ED0]">Before sign in</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">Find your organization</h2>
            <p className="mt-1.5 text-sm font-medium text-slate-500">
              Choose the student body organization connected to your account.
            </p>
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-slate-800">Search organizations</span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by organization, acronym, or college"
                  className="h-11 w-full rounded-md border border-[#DDE7EF] bg-white pl-10 pr-4 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15"
                />
              </span>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-slate-800">Student body organization</span>
              <span className="relative block">
                <select
                  value={selectedId}
                  onChange={(event) => {
                    setSelectedId(event.target.value);
                    setError(null);
                  }}
                  disabled={loading}
                  className="h-11 w-full appearance-none rounded-md border border-[#DDE7EF] bg-white pl-3.5 pr-10 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#0B8ED0] focus:ring-4 focus:ring-[#16C7F3]/15 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <option value="">{loading ? 'Loading organizations...' : 'Select your organization...'}</option>
                  {filteredOrganizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
              </span>
            </label>

            {quickChoices.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-bold uppercase text-slate-500">Common choices</p>
                <div className="flex flex-wrap gap-2">
                  {quickChoices.map((organization) => (
                    <button
                      key={organization.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(String(organization.id));
                        setError(null);
                      }}
                      className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                        String(organization.id) === selectedId
                          ? 'border-[#0B8ED0] bg-[#E9F7FD] text-[#0878B7]'
                          : 'border-[#DDE7EF] bg-white text-slate-600 hover:border-[#0B8ED0] hover:text-[#0878B7]'
                      }`}
                    >
                      {organization.acronym || organization.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-600">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#0B8ED0] px-4 text-sm font-bold text-white shadow-lg shadow-[#0B8ED0]/20 transition hover:bg-[#0878B7] active:scale-[0.99] disabled:opacity-60"
            >
              Continue to login
              <ArrowRight size={17} />
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
