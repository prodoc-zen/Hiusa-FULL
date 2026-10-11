// The one place the end-to-end suite names its sign-ins. Every account here exists after
// `php artisan migrate:fresh --seed` (the CI database); no spec hardcodes a School ID.
// Sources: server/database/seeders (AdministratorSeeder, UserSeeder, DepartmentHeadSeeder,
// OrganizationSeeder, CollegeSeeder) and the README "Demo Accounts" section.

export const SAO = { schoolId: 990001, password: 'Admin@123456', role: 'SUPER_ADMIN', home: '/dashboard/super-admin' };

// PSITS-CCS (organization 2, in the College of Computer Studies): the organization the seeded events,
// budgets, elections and merchandise belong to.
export const PSITS_ADMIN = { schoolId: 900001, password: 'Demo@12345', role: 'ADMIN', home: '/dashboard/admin' };
export const PSITS_ADVISER = { schoolId: 990002, password: 'Admin@123456', role: 'ADMIN', home: '/dashboard/admin' };
export const OFFICER = { schoolId: 900004, password: 'Demo@12345', role: 'SBO_OFFICER', home: '/dashboard/officer' };
export const OFFICER_AUDITOR = { schoolId: 900005, password: 'Demo@12345', role: 'SBO_OFFICER', home: '/dashboard/officer' };

export const HEAD_CCS = { schoolId: 940001, password: 'Demo@12345', role: 'DEPARTMENT_HEAD', home: '/dashboard/department-head' };
export const HEAD_CBE = { schoolId: 940002, password: 'Demo@12345', role: 'DEPARTMENT_HEAD', home: '/dashboard/department-head' };

export const STUDENT = { schoolId: 2100142, password: 'Demo@12345', role: 'STUDENT', home: '/dashboard/student' };
export const STUDENT_B = { schoolId: 2100217, password: 'Demo@12345', role: 'STUDENT', home: '/dashboard/student' };
export const STUDENT_C = { schoolId: 2100389, password: 'Demo@12345', role: 'STUDENT', home: '/dashboard/student' };

// The organization the PSITS people belong to, and the college it sits in.
export const PSITS_ORGANIZATION_ID = 2;
export const CCS_HOME_ORGANIZATION_ID = 7;

export const BY_ROLE = {
  SUPER_ADMIN: SAO,
  ADMIN: PSITS_ADMIN,
  SBO_OFFICER: OFFICER,
  DEPARTMENT_HEAD: HEAD_CCS,
  STUDENT,
};
