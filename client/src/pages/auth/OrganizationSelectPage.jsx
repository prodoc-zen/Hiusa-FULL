import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AuthLayout from '../../components/auth/AuthLayout';
import { Button, Field, Select } from '../../components/ui';
import { formatDisplayText } from '../../utils/displayText.js';
import { getOrganizations } from '../../services/organizationService';
import { unwrapList } from '../../services/pagination';

const STORAGE_KEY = 'selected_organization';

export default function OrganizationSelectPage() {
  const navigate = useNavigate();
  const [organizations, setOrganizations] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;

    getOrganizations({ for_login: 1 })
      .then((response) => {
        if (!alive) return;
        // /organizations deliberately stays a bare, unpaginated array (a
        // handful of rows, and it gates the whole app pre-login) - unwrapList
        // still guards against a shape surprise without changing behavior.
        const organizationList = unwrapList(response.data);
        setOrganizations(organizationList);

        const stored = localStorage.getItem(STORAGE_KEY);
        const storedOrganization = stored ? JSON.parse(stored) : null;

        if (storedOrganization?.id && organizationList.some((org) => org.id === storedOrganization.id)) {
          setSelectedId(String(storedOrganization.id));
        }
      })
      .catch(() => {
        if (alive) {
          setError('We could not load the organization list. Try again.');
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

  const selectedOrganization = organizations.find((organization) => String(organization.id) === selectedId);

  function handleContinue(event) {
    event.preventDefault();

    if (!selectedOrganization) {
      setError('Select your organization to continue.');
      return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedOrganization));
    navigate('/login');
  }

  return (
    <AuthLayout>
      <h1 className="text-xl font-semibold text-ink sm:text-2xl">Select your organization</h1>

      <form onSubmit={handleContinue} className="mt-6 space-y-4" noValidate>
        <Field label="Organization" error={error}>
          <Select
            filter
            value={selectedId}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setError(null);
            }}
            disabled={loading}
          >
            <option value="">{loading ? 'Loading organizations' : 'Select your organization'}</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.organization_type === 'SYSTEM_ADMINISTRATION' ? `${formatDisplayText(organization.name)} (System Access)` : formatDisplayText(organization.name)}
              </option>
            ))}
          </Select>
        </Field>

        <Button type="submit" disabled={loading} className="w-full">Continue to login</Button>
      </form>
    </AuthLayout>
  );
}
