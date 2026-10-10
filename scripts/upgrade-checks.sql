-- Read-only checks to run after the college hierarchy upgrade (MySQL or MariaDB).
-- Every query should return zero rows in the "must be empty" sections.
-- Usage: mysql -u <user> -p <database> < scripts/upgrade-checks.sql

SELECT '1. colleges (review: these are the fixed list the SAO now sees)' AS section;
SELECT id, name, code, is_active FROM colleges ORDER BY name;

SELECT '2. must be empty: colleges without a home organization' AS section;
SELECT c.id, c.name
FROM colleges c
LEFT JOIN organizations o ON o.college_id = c.id AND o.organization_type = 'COLLEGE'
WHERE o.id IS NULL;

SELECT '3. must be empty: student organizations without a college' AS section;
SELECT id, name, college
FROM organizations
WHERE organization_type = 'STUDENT_ORGANIZATION' AND college_id IS NULL;

SELECT '4. must be empty: Department Heads outside a college home organization' AS section;
SELECT u.school_id, u.first_name, u.last_name, o.name AS organization, o.organization_type
FROM users u
JOIN organizations o ON o.id = u.organization_id
WHERE u.role = 'DEPARTMENT_HEAD' AND o.organization_type <> 'COLLEGE';

SELECT '5. must be empty: Department Head profiles outside a college home organization' AS section;
SELECT p.id, p.user_school_id, o.name AS organization, o.organization_type
FROM account_profiles p
JOIN organizations o ON o.id = p.organization_id
WHERE p.role = 'DEPARTMENT_HEAD' AND o.organization_type <> 'COLLEGE';

SELECT '6. review: Department Heads per college (more than one active head needs a decision)' AS section;
SELECT c.name AS college,
       SUM(u.account_status = 'active') AS active_heads,
       COUNT(u.school_id) AS total_heads
FROM colleges c
LEFT JOIN organizations o ON o.college_id = c.id AND o.organization_type = 'COLLEGE'
LEFT JOIN users u ON u.organization_id = o.id AND u.role = 'DEPARTMENT_HEAD'
GROUP BY c.id, c.name
ORDER BY c.name;

SELECT '7. review: student organizations by lifecycle and active flag (all existing ones should be active)' AS section;
SELECT lifecycle_status, is_active, COUNT(*) AS organizations
FROM organizations
WHERE organization_type = 'STUDENT_ORGANIZATION'
GROUP BY lifecycle_status, is_active;

SELECT '8. must be empty: inactive student organizations marked active in lifecycle (they would show as active but block sign-in)' AS section;
SELECT id, name
FROM organizations
WHERE organization_type = 'STUDENT_ORGANIZATION' AND is_active = 0 AND lifecycle_status = 'active';

SELECT '9. must be empty: users whose primary organization has no matching account profile' AS section;
SELECT u.school_id, u.role, u.organization_id
FROM users u
LEFT JOIN account_profiles p ON p.user_school_id = u.school_id AND p.organization_id = u.organization_id
WHERE p.id IS NULL;

SELECT '10. review: free-text college names that did not match a college row (fix the name or add the college)' AS section;
SELECT o.id, o.name, o.college
FROM organizations o
WHERE o.organization_type = 'STUDENT_ORGANIZATION' AND o.college IS NOT NULL AND o.college <> ''
  AND NOT EXISTS (SELECT 1 FROM colleges c WHERE c.name = o.college);

SELECT '11. review: new indexes exist' AS section;
SELECT index_name, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columns_in_index
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = 'audit_logs'
  AND index_name IN ('audit_logs_organization_id_created_at_index', 'audit_logs_user_id_created_at_index')
GROUP BY index_name;
