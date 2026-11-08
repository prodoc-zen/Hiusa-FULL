import crypto from 'node:crypto';
import { expect } from '@playwright/test';
import { HEAD_CCS, SAO, apiAs, apiCall, pdfFile } from './live.js';

// Seeds the one organization pipeline through the API: a student who signs up from the school records,
// the Department Head allowing that student to apply, the application itself and the dean's endorsement.
// Journeys call these to put the world in the state they start from, then drive the screens under test.

let counter = 0;
const runTag = Date.now().toString(36).slice(-5);

export function uniqueName(label) {
  counter += 1;
  return `${label} ${runTag}${counter}`;
}

export function uniqueAcronym(prefix) {
  counter += 1;
  return `${prefix}${runTag}${counter}`.toUpperCase().slice(0, 12);
}

export function randomPassword() {
  return `Pw-${crypto.randomBytes(9).toString('base64url')}-9a`;
}

async function throttled(call) {
  let last = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    last = await call();
    if (last.status !== 429) return last;
    await new Promise((resolve) => setTimeout(resolve, 8000));
  }
  return last;
}

// The SAO opens a semester and publishes the organization requirements, once per database.
export async function ensureOpenSemester() {
  const sao = await apiAs(SAO);
  const years = await sao.get('/system/academic-years');
  expect(years.ok, 'the SAO can list academic years').toBe(true);
  const year = years.body.find((candidate) => candidate.is_current) ?? years.body[0];
  const active = await sao.get('/academic-periods/active');
  if (!active.body?.id) {
    let semester = year.semesters.find((candidate) => candidate.status === 'active') ?? year.semesters[0];
    if (!semester) {
      const created = await sao.post(`/system/academic-years/${year.id}/semesters`, { number: 1, starts_on: year.starts_on, ends_on: year.ends_on });
      expect(created.status, JSON.stringify(created.body).slice(0, 200)).toBe(201);
      semester = created.body;
    }
    const activated = await sao.patch(`/system/academic-semesters/${semester.id}/active`);
    expect(activated.ok, JSON.stringify(activated.body).slice(0, 200)).toBe(true);
  }
  const requirements = await sao.get(`/compliance/requirement-types?per_page=100&category=organization&academic_year=${year.label}`);
  for (const type of (requirements.body?.data ?? [])) {
    if (!type.is_active) {
      await sao.put(`/compliance/requirement-types/${type.id}`, { is_active: true, template_url: 'https://example.edu/format.pdf' });
    }
  }
}

// The dean's student records file gains one row for a student who has not signed up yet.
// Without a college code the dean of the Computer Studies college loads it; with one, the SAO does.
export async function addStudentRecord(label = 'Journey', collegeCode = null) {
  const dean = await apiAs(collegeCode ? SAO : HEAD_CCS);
  counter += 1;
  const schoolId = 26000000 + (Date.now() % 900000) * 10 + (counter % 10);
  const birthDate = '2005-05-05';
  const firstName = `${label}${counter}`;
  const lastName = `Student${runTag}`;
  const csv = collegeCode
    ? `school_id,first_name,last_name,birth_date,program,year_level,section,college_code\n${schoolId},${firstName},${lastName},${birthDate},BSIT,3,A,${collegeCode}\n`
    : `school_id,first_name,last_name,birth_date,program,year_level,section\n${schoolId},${firstName},${lastName},${birthDate},BSIT,3,A\n`;
  const upload = () => {
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'journey-student.csv');
    return form;
  };
  const preview = await throttled(() => dean.post('/students/registry/preview', upload()));
  expect(preview.ok, JSON.stringify(preview.body).slice(0, 300)).toBe(true);
  const apply = upload();
  apply.append('hash', preview.body.hash);
  apply.append('preview_token', preview.body.preview_token);
  apply.append('confirm', '1');
  const applied = await throttled(() => dean.post('/students/registry/apply', apply));
  expect(applied.ok, JSON.stringify(applied.body).slice(0, 300)).toBe(true);

  return { schoolId, birthDate, firstName, lastName, name: `${firstName} ${lastName}` };
}

// A student of the Dean's college who signs up the way a real one does: the record exists, then the student
// matches it with school ID and birth date and chooses an email and password.
export async function newStudent(label = 'Journey', collegeCode = null) {
  const record = await addStudentRecord(label, collegeCode);
  const { schoolId, birthDate, firstName, lastName } = record;
  const password = randomPassword();
  const email = `${firstName}.${runTag}@journey.test`.toLowerCase();
  const registered = await throttled(() => apiCall('', 'POST', '/register', { school_id: schoolId, birth_date: birthDate, email, password, password_confirmation: password }));
  expect(registered.status, JSON.stringify(registered.body).slice(0, 300)).toBe(201);
  return { schoolId, password, email, firstName, lastName, name: `${firstName} ${lastName}`, role: 'STUDENT', home: '/dashboard/student' };
}

export async function allowToApply(student) {
  const dean = await apiAs(HEAD_CCS);
  const granted = await dean.post('/college/applicant-grants', { school_id: student.schoolId });
  expect(granted.status, JSON.stringify(granted.body).slice(0, 300)).toBe(201);
  return granted.body;
}

// The student sends an application with one PDF per open requirement. Returns { id, name, acronym }.
export async function submitApplication(student, { name = uniqueName('Journey Society'), acronym = uniqueAcronym('JS'), positionTitle = 'President' } = {}) {
  const me = await apiAs(student);
  const open = await me.get('/my/organization-applications');
  expect(open.body?.can_apply, 'the student is allowed to apply').toBe(true);
  expect(open.body.requirements.length, 'registration requirements are open').toBeGreaterThan(0);
  const form = new FormData();
  form.append('name', name);
  form.append('acronym', acronym);
  form.append('position_title', positionTitle);
  form.append('description', 'Sent by an acceptance journey.');
  for (const requirement of open.body.requirements) {
    const file = pdfFile(`${requirement.name}.pdf`, `${name} ${requirement.name}`);
    form.append(`files[${requirement.id}]`, new Blob([file.buffer], { type: file.mimeType }), file.name);
  }
  const sent = await me.post('/my/organization-applications', form);
  expect(sent.status, JSON.stringify(sent.body).slice(0, 300)).toBe(201);
  return { id: sent.body.id, name, acronym, student };
}

export async function endorse(application) {
  const dean = await apiAs(HEAD_CCS);
  const decided = await dean.patch(`/organization-applications/${application.id}/review`, { action: 'endorse' });
  expect(decided.ok, JSON.stringify(decided.body).slice(0, 300)).toBe(true);
}

export async function returnApplication(application, remarks, actor = HEAD_CCS) {
  const reviewer = await apiAs(actor);
  const decided = await reviewer.patch(`/organization-applications/${application.id}/review`, { action: 'return', remarks });
  expect(decided.ok, JSON.stringify(decided.body).slice(0, 300)).toBe(true);
}

export async function approve(application) {
  const sao = await apiAs(SAO);
  const decided = await sao.patch(`/organization-applications/${application.id}/review`, { action: 'approve' });
  expect(decided.ok, JSON.stringify(decided.body).slice(0, 300)).toBe(true);
}
