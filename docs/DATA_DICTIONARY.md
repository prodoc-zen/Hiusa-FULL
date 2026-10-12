# Data dictionary

Generated from the staging database schema on 2026-10-13 (MySQL 8, 65 tables, 745 columns). Grouped by module. `?` after a type means the column can be empty. PK is the primary key, UQ is unique, FK points to the table it references.

## Identity and access

### users

System accounts. Primary key is the School ID.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| school_id | int unsigned | no | PK |  |  |
| first_name | varchar(60) | no |  |  |  |
| last_name | varchar(60) | no |  |  |  |
| is_member | tinyint(1) | no |  |  | `0` |
| account_status | varchar(20) | no |  |  | `active` |
| email | varchar(100) | no |  |  |  |
| contact_number | varchar(30) | yes |  |  |  |
| password_hash | varchar(255) | no |  |  |  |
| role | varchar(20) | no |  |  | `STUDENT` |
| position_title | varchar(100) | yes |  |  |  |
| biometric_template | longblob | yes |  |  |  |
| notification_preferences | longtext | yes |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |
| organization_id | bigint unsigned | no | FK | organizations.id |  |
| department | varchar(120) | yes |  |  |  |
| program | varchar(120) | yes |  |  |  |
| year_level | varchar(30) | yes |  |  |  |
| major | varchar(120) | yes |  |  |  |
| section | varchar(60) | yes |  |  |  |
| photo_path | varchar(255) | yes |  |  |  |
| must_change_password | tinyint(1) | no |  |  | `0` |

### account_profiles

A user's role and organization membership (the active profile decides what they can do).

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| user_school_id | int unsigned | no | FK | users.school_id |  |
| organization_id | bigint unsigned | no | FK | organizations.id |  |
| role | varchar(32) | no |  |  |  |
| account_status | varchar(16) | no |  |  | `active` |
| position_title | varchar(100) | yes |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### personal_access_tokens

API sign-in tokens (Laravel Sanctum).

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| tokenable_type | varchar(255) | no |  |  |  |
| tokenable_id | bigint unsigned | no |  |  |  |
| name | text | no |  |  |  |
| token | varchar(64) | no | UQ |  |  |
| abilities | text | yes |  |  |  |
| last_used_at | timestamp | yes |  |  |  |
| expires_at | timestamp | yes |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |
| account_profile_id | bigint unsigned | yes | FK | account_profiles.id |  |

### password_reset_tokens

Password reset tokens.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| email | varchar(255) | no | PK |  |  |
| organization_id | bigint unsigned | yes | FK | organizations.id |  |
| token | varchar(255) | no |  |  |  |
| created_at | timestamp | yes |  |  |  |

### sessions

Web sessions.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | varchar(255) | no | PK |  |  |
| user_id | int unsigned | yes |  |  |  |
| ip_address | varchar(45) | yes |  |  |  |
| user_agent | text | yes |  |  |  |
| payload | longtext | no |  |  |  |
| last_activity | int | no |  |  |  |

### fingerprints

Enrolled fingerprint templates, stored encrypted.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | no | FK | organizations.id |  |
| user_id | int unsigned | no | FK | users.school_id |  |
| template | longtext | no |  |  |  |
| template_format | varchar(100) | no |  |  |  |
| finger_index | tinyint unsigned | no |  |  | `0` |
| enrolled_by | int unsigned | yes | FK | users.school_id |  |
| enrolled_at | timestamp | no |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### fingerprint_verifications

Fingerprint verification attempts and tokens used for check-in.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | no | FK | organizations.id |  |
| user_id | int unsigned | yes | FK | users.school_id |  |
| performed_by | int unsigned | yes | FK | users.school_id |  |
| event_id | bigint unsigned | yes | FK | events.id |  |
| result | varchar(32) | no |  |  |  |
| score | decimal(10,4) | yes |  |  |  |
| threshold | decimal(10,4) | yes |  |  |  |
| verified_at | timestamp | no |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

## Colleges, organizations and the academic calendar

### colleges

The fixed list of colleges.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| name | varchar(255) | no | UQ |  |  |
| code | varchar(50) | yes | UQ |  |  |
| description | text | yes |  |  |  |
| is_active | tinyint(1) | no |  |  | `1` |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |
| color | varchar(7) | yes |  |  |  |
| logo_url | varchar(255) | yes |  |  |  |

### organizations

College home organizations and student organizations, with lifecycle status (pending, returned, active, archived).

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| name | varchar(255) | no | UQ |  |  |
| slug | varchar(255) | no | UQ |  |  |
| college | varchar(255) | yes |  |  |  |
| acronym | varchar(50) | yes |  |  |  |
| organization_type | varchar(50) | no |  |  | `STUDENT_ORGANIZATION` |
| description | text | yes |  |  |  |
| logo_url | varchar(255) | yes |  |  |  |
| gcash_qr_url | varchar(500) | yes |  |  |  |
| is_active | tinyint(1) | no |  |  | `1` |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |
| parent_organization_id | bigint unsigned | yes | FK | organizations.id |  |
| color | varchar(7) | yes |  |  |  |
| college_id | bigint unsigned | yes | FK | colleges.id |  |
| lifecycle_status | varchar(20) | no |  |  | `active` |
| submitted_by | int unsigned | yes | FK | users.school_id |  |
| submitted_at | timestamp | yes |  |  |  |
| reviewed_by | int unsigned | yes | FK | users.school_id |  |
| reviewed_at | timestamp | yes |  |  |  |
| review_remarks | text | yes |  |  |  |
| archived_at | timestamp | yes |  |  |  |
| archived_by | int unsigned | yes | FK | users.school_id |  |

### sbo_positions

Officer positions of each organization.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | no | FK | organizations.id |  |
| role | varchar(30) | no |  |  | `SBO_OFFICER` |
| title | varchar(100) | no |  |  |  |
| description | text | yes |  |  |  |
| is_active | tinyint(1) | no |  |  | `1` |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### academic_years

Academic years, one marked current.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| label | varchar(20) | no | UQ |  |  |
| starts_on | date | no |  |  |  |
| ends_on | date | no |  |  |  |
| is_current | tinyint(1) | no |  |  | `0` |
| created_by | int unsigned | yes | FK | users.school_id |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |
| closed_at | timestamp | yes |  |  |  |

### academic_semesters

Semesters inside an academic year; one is active.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| academic_year_id | bigint unsigned | no | FK | academic_years.id |  |
| number | tinyint unsigned | no |  |  |  |
| starts_on | date | no |  |  |  |
| ends_on | date | no |  |  |  |
| status | varchar(20) | no |  |  | `upcoming` |
| created_by | int unsigned | yes | FK | users.school_id |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### academic_programs

Programs (courses) of an organization.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | no | FK | organizations.id |  |
| name | varchar(120) | no |  |  |  |
| duration_years | tinyint unsigned | no |  |  | `4` |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### academic_sections

Sections of a program.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| academic_program_id | bigint unsigned | no | FK | academic_programs.id |  |
| year_level | tinyint unsigned | no |  |  |  |
| name | varchar(60) | no |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

## Compliance and accreditation

### compliance_requirement_types

Documents the SAO requires for accreditation, each with a deadline.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| academic_year | varchar(20) | no |  |  |  |
| name | varchar(255) | no |  |  |  |
| description | text | yes |  |  |  |
| deadline_at | datetime | no |  |  |  |
| is_active | tinyint(1) | no |  |  | `1` |
| created_by | int unsigned | no | FK | users.school_id |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |
| academic_semester_id | bigint unsigned | yes | FK | academic_semesters.id |  |

### organization_compliance_submissions

Each organization's submitted document per requirement, with review status.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | no | FK | organizations.id |  |
| requirement_type_id | bigint unsigned | no | FK | compliance_requirement_types.id |  |
| status | varchar(20) | no |  |  | `submitted` |
| file_path | varchar(500) | no |  |  |  |
| file_original_name | varchar(255) | no |  |  |  |
| mime_type | varchar(100) | no |  |  |  |
| file_size | int unsigned | no |  |  |  |
| remarks | text | yes |  |  |  |
| submitted_by | int unsigned | no | FK | users.school_id |  |
| submitted_at | datetime | no |  |  |  |
| reviewed_by | int unsigned | yes | FK | users.school_id |  |
| reviewed_at | datetime | yes |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### event_requirements

SAO checklist of documents required for events (on-campus or off-campus).

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| name | varchar(150) | no |  |  |  |
| allowed_extensions | json | no |  |  |  |
| is_active | tinyint(1) | no |  |  | `1` |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |
| description | varchar(500) | yes |  |  |  |
| sort_order | int unsigned | no |  |  | `0` |
| venue_type | varchar(20) | no |  |  | `all` |
| academic_semester_id | bigint unsigned | yes | FK | academic_semesters.id |  |
| is_optional | tinyint(1) | no |  |  | `0` |

### event_requirement_files

Files an organization uploaded for an event requirement.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| event_id | bigint unsigned | no | FK | events.id |  |
| requirement_id | bigint unsigned | no | FK | event_requirements.id |  |
| organization_id | bigint unsigned | no | FK | organizations.id |  |
| path | varchar(255) | no |  |  |  |
| original_name | varchar(255) | no |  |  |  |
| uploaded_by | int unsigned | no | FK | users.school_id |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### financial_report_deadlines

SAO deadline for financial reports (stored, no screen writes it yet).

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| deadline_at | timestamp | no |  |  |  |
| instructions | text | yes |  |  |  |
| set_by | int unsigned | yes | FK | users.school_id |  |
| announcement_id | bigint unsigned | yes | FK | announcements.id |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

## Events, venues and attendance

### events

Event proposals and their approval and lifecycle status.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | yes | FK | organizations.id |  |
| title | varchar(255) | no |  |  |  |
| description | text | yes |  |  |  |
| image_url | varchar(255) | yes |  |  |  |
| start_time | datetime | no |  |  |  |
| end_time | datetime | no |  |  |  |
| location | varchar(255) | yes |  |  |  |
| status | enum('planning','approved','ongoing','completed','cancelled') | no |  |  | `planning` |
| requires_budget | tinyint(1) | no |  |  | `0` |
| planning_details | longtext | yes |  |  |  |
| approved_at | datetime | yes |  |  |  |
| created_by | int unsigned | no | FK | users.school_id |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |
| academic_semester_id | bigint unsigned | yes | FK | academic_semesters.id |  |

### event_registrations

Student registrations for events.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| event_id | bigint unsigned | no | FK | events.id |  |
| organization_id | bigint unsigned | no | FK | organizations.id |  |
| user_id | int unsigned | no | FK | users.school_id |  |
| status | varchar(20) | no |  |  | `registered` |
| registered_at | datetime | no |  |  |  |
| cancelled_at | datetime | yes |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### attendance

Check-in records (present, late, excused, absent).

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| event_id | bigint unsigned | no | FK | events.id |  |
| user_id | int unsigned | no | FK | users.school_id |  |
| check_in_time | datetime | no |  |  | `CURRENT_TIMESTAMP` |
| check_out_time | datetime | yes |  |  |  |
| method | enum('biometric','manual') | no |  |  | `manual` |
| status | varchar(20) | no |  |  | `present` |
| recorded_by | int unsigned | yes | FK | users.school_id |  |
| remarks | varchar(255) | yes |  |  |  |

### venues

SAO venue catalog.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| name | varchar(255) | no |  |  |  |
| location | varchar(255) | no |  |  |  |
| capacity | int unsigned | no |  |  | `0` |
| is_active | tinyint(1) | no |  |  | `1` |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### venue_bookings

Venue requests with approval status.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| venue_id | bigint unsigned | yes | FK | venues.id |  |
| event_id | bigint unsigned | yes | FK | events.id |  |
| organization_id | bigint unsigned | no | FK | organizations.id |  |
| start_time | datetime | no |  |  |  |
| end_time | datetime | no |  |  |  |
| status | varchar(20) | no |  |  | `pending` |
| remarks | text | yes |  |  |  |
| requested_by | int unsigned | no | FK | users.school_id |  |
| reviewed_by | int unsigned | yes | FK | users.school_id |  |
| reviewed_at | datetime | yes |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |
| off_campus_location | varchar(255) | yes |  |  |  |

## Tasks

### tasks

Tasks assigned to officers, optionally tied to an event.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | yes | FK | organizations.id |  |
| event_id | bigint unsigned | yes | FK | events.id |  |
| task_type | varchar(20) | no |  |  | `regular` |
| phase | varchar(40) | yes |  |  |  |
| priority | varchar(20) | no |  |  | `medium` |
| sequence | int unsigned | yes |  |  |  |
| preferred_role | varchar(100) | yes |  |  |  |
| depends_on_task_id | bigint unsigned | yes | FK | tasks.id |  |
| is_ai_generated | tinyint(1) | no |  |  | `0` |
| created_by | int unsigned | no | FK | users.school_id |  |
| title | varchar(255) | no |  |  |  |
| description | text | yes |  |  |  |
| assigned_to | int unsigned | yes | FK | users.school_id |  |
| assigned_at | timestamp | yes |  |  |  |
| status | enum('pending','in_progress','completed','overdue') | no |  |  | `pending` |
| deadline | datetime | no |  |  |  |
| ai_recommendation_note | text | yes |  |  |  |
| role_score | decimal(6,2) | yes |  |  |  |
| workload_score | decimal(6,2) | yes |  |  |  |
| performance_score | decimal(6,2) | yes |  |  |  |
| recency_score | decimal(6,2) | yes |  |  |  |
| final_score | decimal(8,2) | yes |  |  |  |
| delegation_snapshot | json | yes |  |  |  |
| progress_percent | tinyint unsigned | no |  |  | `0` |
| completed_at | datetime | yes |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |
| academic_semester_id | bigint unsigned | yes | FK | academic_semesters.id |  |
| category | varchar(40) | yes |  |  |  |

### task_progress_updates

Progress notes on a task.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| task_id | bigint unsigned | no | FK | tasks.id |  |
| organization_id | bigint unsigned | no | FK | organizations.id |  |
| updated_by | int unsigned | yes | FK | users.school_id |  |
| status | varchar(30) | no |  |  |  |
| progress_percent | tinyint unsigned | no |  |  | `0` |
| note | text | yes |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### task_recommendations

AI task delegation recommendations.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| task_id | bigint unsigned | yes | FK | tasks.id |  |
| ai_output_id | bigint unsigned | yes | FK | ai_outputs.id |  |
| organization_id | bigint unsigned | no | FK | organizations.id |  |
| officer_id | int unsigned | yes | FK | users.school_id |  |
| role_score | decimal(6,2) | yes |  |  |  |
| workload_score | decimal(6,2) | yes |  |  |  |
| performance_score | decimal(6,2) | yes |  |  |  |
| recency_score | decimal(6,2) | yes |  |  |  |
| weights | json | no |  |  |  |
| total_score | decimal(6,2) | yes |  |  |  |
| rank | int unsigned | yes |  |  |  |
| eligibility_result | varchar(30) | no |  |  |  |
| calculated_at | timestamp | no |  |  | `CURRENT_TIMESTAMP` |

## Finance

### budgets

Budgets per organization or event, with approval status.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | yes | FK | organizations.id |  |
| event_id | bigint unsigned | yes | FK | events.id |  |
| title | varchar(255) | no |  |  |  |
| allocated_amount | decimal(10,2) | no |  |  | `0.00` |
| remaining_amount | decimal(10,2) | yes |  |  |  |
| warning_threshold | decimal(10,2) | no |  |  | `0.00` |
| advisory_note | text | yes |  |  |  |
| overspending_risk | varchar(20) | yes |  |  |  |
| submission_status | varchar(40) | no |  |  | `pending_department_head` |
| department_head_approved_by | int unsigned | yes | FK | users.school_id |  |
| department_head_approved_at | timestamp | yes |  |  |  |
| recommended_allocation | decimal(12,2) | yes |  |  |  |
| safe_spending_limit | decimal(12,2) | yes |  |  |  |
| advice_generated_at | timestamp | yes |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |
| financial_semester_id | bigint unsigned | yes | FK | financial_semesters.id |  |

### transactions

The ledger: income and expense entries with receipt numbers.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | yes | FK | organizations.id |  |
| budget_id | bigint unsigned | yes | FK | budgets.id |  |
| event_id | bigint unsigned | yes | FK | events.id |  |
| recorded_by | int unsigned | no | FK | users.school_id |  |
| payer_id | int unsigned | yes | FK | users.school_id |  |
| type | enum('income','expense') | no |  |  |  |
| category | varchar(100) | no |  |  |  |
| amount | decimal(10,2) | no |  |  |  |
| description | text | no |  |  |  |
| receipt_reference | varchar(100) | yes | UQ |  |  |
| receipt_number | int unsigned | yes |  |  |  |
| receipt_file_url | varchar(500) | yes |  |  |  |
| transaction_date | datetime | no |  |  | `CURRENT_TIMESTAMP` |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### financial_forecasts

AI financial forecasts.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | yes | FK | organizations.id |  |
| forecast_period | varchar(50) | no |  |  |  |
| predicted_income | decimal(10,2) | no |  |  |  |
| predicted_expense | decimal(10,2) | no |  |  |  |
| predicted_balance | decimal(10,2) | yes |  |  |  |
| safe_spending_limit | decimal(10,2) | yes |  |  |  |
| confidence_note | text | yes |  |  |  |
| model_details | longtext | yes |  |  |  |
| generated_by | int unsigned | yes | FK | users.school_id |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### financial_reports

Generated financial reports and their approval chain.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | yes | FK | organizations.id |  |
| event_id | bigint unsigned | yes | FK | events.id |  |
| report_type | varchar(40) | no |  |  |  |
| document_type | varchar(40) | no |  |  | `financial_report` |
| title | varchar(255) | no |  |  |  |
| period_start | date | yes |  |  |  |
| period_end | date | yes |  |  |  |
| summary_text | longtext | yes |  |  |  |
| letterhead_path | varchar(500) | yes |  |  |  |
| letter_details | json | yes |  |  |  |
| signatories | json | yes |  |  |  |
| source_transaction_ids | longtext | yes |  |  |  |
| supporting_documents | json | yes |  |  |  |
| submission_status | varchar(40) | no |  |  | `draft` |
| deadline_id | bigint unsigned | yes | FK | financial_report_deadlines.id |  |
| pdf_url | varchar(500) | yes |  |  |  |
| excel_url | varchar(500) | yes |  |  |  |
| ai_output_id | bigint unsigned | yes | FK | ai_outputs.id |  |
| generated_by | int unsigned | yes | FK | users.school_id |  |
| generated_at | timestamp | no |  |  | `CURRENT_TIMESTAMP` |
| submitted_at | timestamp | yes |  |  |  |
| department_head_approved_by | int unsigned | yes | FK | users.school_id |  |
| department_head_approved_at | timestamp | yes |  |  |  |
| sao_approved_by | int unsigned | yes | FK | users.school_id |  |
| sao_approved_at | timestamp | yes |  |  |  |
| financial_semester_id | bigint unsigned | yes | FK | financial_semesters.id |  |
| opening_balance_snapshot | decimal(14,2) | yes |  |  |  |
| transactions_snapshot | json | yes |  |  |  |
| custody_snapshot | json | yes |  |  |  |

### financial_semesters

Financial periods used by reports.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | no | FK | organizations.id |  |
| name | varchar(100) | no |  |  |  |
| starts_on | date | no |  |  |  |
| ends_on | date | no |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### collections

Money collected from members, verified by a second admin.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | no | FK | organizations.id |  |
| reference | varchar(50) | no | UQ |  |  |
| expected_amount | decimal(12,2) | no |  |  | `0.00` |
| amount_collected | decimal(12,2) | no |  |  |  |
| source | varchar(100) | no |  |  |  |
| notes | text | yes |  |  |  |
| event_id | bigint unsigned | yes | FK | events.id |  |
| order_id | bigint unsigned | yes | FK | orders.id |  |
| collected_by | int unsigned | no | FK | users.school_id |  |
| verified_by | int unsigned | yes | FK | users.school_id |  |
| collected_at | timestamp | no |  |  |  |
| verified_at | timestamp | yes |  |  |  |
| status | enum('pending','verified','rejected') | no |  |  | `pending` |
| ledger_transaction_id | bigint unsigned | yes | FK | transactions.id |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### remittances

Remittance of collected money to the organization.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| collection_id | bigint unsigned | no | FK | collections.id |  |
| reference | varchar(50) | no | UQ |  |  |
| amount | decimal(12,2) | no |  |  |  |
| remitted_by | int unsigned | no | FK | users.school_id |  |
| verified_by | int unsigned | yes | FK | users.school_id |  |
| remitted_at | timestamp | no |  |  |  |
| verified_at | timestamp | yes |  |  |  |
| status | varchar(20) | no |  |  | `recorded` |
| notes | text | yes |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### cash_advances

Cash advances with approval and release.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | no | FK | organizations.id |  |
| reference | varchar(50) | no | UQ |  |  |
| borrower_id | int unsigned | no | FK | users.school_id |  |
| amount | decimal(12,2) | no |  |  |  |
| purpose | text | no |  |  |  |
| event_id | bigint unsigned | yes | FK | events.id |  |
| status | enum('pending','approved','released','partially_repaid','fully_repaid','rejected','cancelled') | no |  |  | `pending` |
| approved_by | int unsigned | yes | FK | users.school_id |  |
| approved_at | timestamp | yes |  |  |  |
| released_by | int unsigned | yes | FK | users.school_id |  |
| released_at | timestamp | yes |  |  |  |
| release_transaction_id | bigint unsigned | yes | FK | transactions.id |  |
| notes | text | yes |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### cash_advance_repayments

Repayments against cash advances.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| cash_advance_id | bigint unsigned | no | FK | cash_advances.id |  |
| amount | decimal(12,2) | no |  |  |  |
| recorded_by | int unsigned | no | FK | users.school_id |  |
| repaid_at | timestamp | no |  |  |  |
| notes | text | yes |  |  |  |
| ledger_transaction_id | bigint unsigned | yes | FK | transactions.id |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### invoices

Charges billed to students.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | no | FK | organizations.id |  |
| reference | varchar(50) | no | UQ |  |  |
| student_id | int unsigned | no | FK | users.school_id |  |
| description | varchar(255) | no |  |  |  |
| amount_due | decimal(12,2) | no |  |  |  |
| due_date | date | yes |  |  |  |
| event_id | bigint unsigned | yes | FK | events.id |  |
| order_id | bigint unsigned | yes | UQ, FK | orders.id |  |
| status | varchar(20) | no |  |  | `unpaid` |
| status_reason | varchar(500) | yes |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### invoice_payments

Payments against invoices.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| invoice_id | bigint unsigned | no | FK | invoices.id |  |
| amount | decimal(12,2) | no |  |  |  |
| recorded_by | int unsigned | no | FK | users.school_id |  |
| status | varchar(20) | no |  |  | `pending` |
| ledger_transaction_id | bigint unsigned | yes | FK | transactions.id |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

## Merchandise and orders

### merchandise

Items for sale.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | yes | FK | organizations.id |  |
| name | varchar(255) | no |  |  |  |
| category | varchar(100) | yes |  |  |  |
| description | text | yes |  |  |  |
| price | decimal(10,2) | no |  |  |  |
| stock_quantity | int | no |  |  | `0` |
| image_url | varchar(255) | yes |  |  |  |
| is_active | tinyint(1) | no |  |  | `1` |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |
| low_stock_threshold | int unsigned | no |  |  | `9` |
| promotion_price | decimal(10,2) | yes |  |  |  |
| promotion_buyer_limit | int unsigned | yes |  |  |  |

### merchandise_variants

Sizes or variants of an item with stock.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| merchandise_id | bigint unsigned | no | FK | merchandise.id |  |
| organization_id | bigint unsigned | no | FK | organizations.id |  |
| name | varchar(100) | no |  |  |  |
| stock_quantity | int unsigned | no |  |  | `0` |
| image_url | varchar(255) | yes |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### orders

Student orders with payment verification and claim token.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | yes | FK | organizations.id |  |
| student_id | int unsigned | no | FK | users.school_id |  |
| merchandise_id | bigint unsigned | no | FK | merchandise.id |  |
| quantity | int | no |  |  | `1` |
| total_price | decimal(10,2) | no |  |  |  |
| payment_method | varchar(20) | yes |  |  |  |
| payment_reference | varchar(150) | yes |  |  |  |
| payment_reference_key | varchar(64) | yes | UQ |  |  |
| payment_proof_url | varchar(500) | yes |  |  |  |
| officer_review_status | varchar(20) | no |  |  | `pending` |
| admin_review_status | varchar(20) | no |  |  | `pending` |
| review_remarks | text | yes |  |  |  |
| status | enum('pending','paid','claimed','cancelled') | no |  |  | `pending` |
| claim_token | varchar(50) | no | UQ |  |  |
| processed_by | int unsigned | yes | FK | users.school_id |  |
| approved_by | int unsigned | yes | FK | users.school_id |  |
| claim_verified_by | int unsigned | yes | FK | users.school_id |  |
| claim_verified_at | datetime | yes |  |  |  |
| transaction_id | bigint unsigned | yes | FK | transactions.id |  |
| claimed_at | datetime | yes |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |
| merchandise_variant_id | bigint unsigned | yes | FK | merchandise_variants.id |  |
| variant_name | varchar(100) | yes |  |  |  |
| unit_price | decimal(10,2) | yes |  |  |  |
| promotion_applied | tinyint(1) | no |  |  | `0` |

## Elections

### elections

Elections with approval, finalization and voting window.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | yes | FK | organizations.id |  |
| title | varchar(255) | no |  |  |  |
| room | varchar(120) | yes |  |  |  |
| image_url | varchar(255) | yes |  |  |  |
| start_time | datetime | no |  |  |  |
| end_time | datetime | no |  |  |  |
| status | enum('upcoming','active','closed','pending_approval') | no |  |  | `upcoming` |
| results_visible | tinyint(1) | no |  |  | `1` |
| approved_at | datetime | yes |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |
| finalized_at | timestamp | yes |  |  |  |
| academic_semester_id | bigint unsigned | yes | FK | academic_semesters.id |  |
| informative_letter_path | varchar(255) | yes |  |  |  |

### election_positions

Positions to be voted on.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| election_id | bigint unsigned | no | FK | elections.id |  |
| title | varchar(100) | no |  |  |  |
| max_winners | int | no |  |  | `1` |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### candidates

Candidates per position.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| election_id | bigint unsigned | no | FK | elections.id |  |
| user_id | int unsigned | no | FK | users.school_id |  |
| position_id | bigint unsigned | no | FK | election_positions.id |  |
| platform | text | yes |  |  |  |
| image_url | varchar(255) | yes |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |
| partylist_id | bigint unsigned | yes | FK | partylists.id |  |

### partylists

Party lists.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | yes | FK | organizations.id |  |
| name | varchar(255) | no |  |  |  |
| acronym | varchar(255) | yes |  |  |  |
| description | text | yes |  |  |  |
| banner_url | varchar(255) | yes |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### votes

Cast votes (one per voter per position).

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| election_id | bigint unsigned | no | FK | elections.id |  |
| position_id | bigint unsigned | no | FK | election_positions.id |  |
| candidate_id | bigint unsigned | no | FK | candidates.id |  |
| voter_id | int unsigned | no | FK | users.school_id |  |
| vote_hash | varchar(255) | no | UQ |  |  |
| cast_at | timestamp | no |  |  | `CURRENT_TIMESTAMP` |

## Announcements and notifications

### announcements

Organization announcements with approval status.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | yes | FK | organizations.id |  |
| announcement_source | varchar(24) | no |  |  | `ORGANIZATION` |
| source_organization_id | bigint unsigned | yes | FK | organizations.id |  |
| title | varchar(255) | no |  |  |  |
| body | text | no |  |  |  |
| image_url | varchar(255) | yes |  |  |  |
| created_by | int unsigned | yes | FK | users.school_id |  |
| target_role | varchar(20) | no |  |  | `all` |
| target_scope | varchar(32) | yes |  |  |  |
| target_organization_ids | json | yes |  |  |  |
| target_departments | json | yes |  |  |  |
| target_roles | json | yes |  |  |  |
| category | varchar(40) | no |  |  | `general` |
| approval_status | varchar(20) | no |  |  | `draft` |
| reviewed_by | int unsigned | yes | FK | users.school_id |  |
| review_remarks | text | yes |  |  |  |
| is_published | tinyint(1) | no |  |  | `0` |
| is_pinned | tinyint(1) | no |  |  | `0` |
| is_important | tinyint(1) | no |  |  | `0` |
| views_count | int unsigned | no |  |  | `0` |
| published_at | datetime | yes |  |  |  |
| scheduled_at | timestamp | yes |  |  |  |
| expires_at | timestamp | yes |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### announcement_recipients

Who an announcement targets.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| announcement_id | bigint unsigned | no | FK | announcements.id |  |
| user_id | int unsigned | no | FK | users.school_id |  |
| organization_id | bigint unsigned | no | FK | organizations.id |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### announcement_reactions

Likes and reactions.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| announcement_id | bigint unsigned | no | FK | announcements.id |  |
| user_id | int unsigned | no | FK | users.school_id |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### announcement_views

Who viewed an announcement.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| announcement_id | bigint unsigned | no | FK | announcements.id |  |
| user_id | int unsigned | no | FK | users.school_id |  |
| viewed_at | timestamp | no |  |  | `CURRENT_TIMESTAMP` |

### notifications

Per-user notifications.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | yes | FK | organizations.id |  |
| user_id | int unsigned | no | FK | users.school_id |  |
| notification_type | varchar(40) | no |  |  | `general` |
| entity_type | varchar(40) | yes |  |  |  |
| title | varchar(255) | no |  |  |  |
| message | text | no |  |  |  |
| reference_type | varchar(40) | yes |  |  |  |
| reference_id | bigint unsigned | yes |  |  |  |
| scheduled_at | datetime | yes |  |  |  |
| sent_at | datetime | yes |  |  |  |
| is_read | tinyint(1) | no |  |  | `0` |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

## Approvals, grievances and clearance

### approval_requests

Approval requests for events, budgets, reports and elections.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | yes | FK | organizations.id |  |
| entity_type | varchar(40) | no |  |  |  |
| entity_id | bigint unsigned | no |  |  |  |
| requested_by | int unsigned | no | FK | users.school_id |  |
| required_role | varchar(30) | no |  |  |  |
| assigned_approver | int unsigned | yes | FK | users.school_id |  |
| status | varchar(20) | no |  |  | `pending` |
| decision | varchar(20) | yes |  |  |  |
| active_key | varchar(100) | yes | UQ |  |  |
| reviewed_by | int unsigned | yes | FK | users.school_id |  |
| remarks | text | yes |  |  |  |
| requested_at | timestamp | no |  |  | `CURRENT_TIMESTAMP` |
| reviewed_at | datetime | yes |  |  |  |

### grievances

Complaints filed by students.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | yes | FK | organizations.id |  |
| submitted_by | int unsigned | no | FK | users.school_id |  |
| is_anonymous | tinyint(1) | no |  |  | `0` |
| title | varchar(255) | no |  |  |  |
| description | text | no |  |  |  |
| category | varchar(100) | yes |  |  |  |
| urgency | varchar(20) | yes |  |  |  |
| classification_confidence | double | yes |  |  |  |
| classification_reasoning | text | yes |  |  |  |
| classification_engine | varchar(20) | yes |  |  |  |
| status | varchar(20) | no |  |  | `submitted` |
| remarks | text | yes |  |  |  |
| resolved_at | datetime | yes |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### clearance_periods

Clearance periods opened by the SAO.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| academic_year | varchar(20) | no |  |  |  |
| title | varchar(255) | no |  |  |  |
| description | text | yes |  |  |  |
| required_roles | json | no |  |  |  |
| deadline_at | datetime | yes |  |  |  |
| created_by | int unsigned | no | FK | users.school_id |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### clearance_signatures

Signature line per student, per required role.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| clearance_period_id | bigint unsigned | no | FK | clearance_periods.id |  |
| student_id | int unsigned | no | FK | users.school_id |  |
| organization_id | bigint unsigned | no | FK | organizations.id |  |
| required_role | varchar(50) | no |  |  |  |
| status | varchar(20) | no |  |  | `pending` |
| remarks | text | yes |  |  |  |
| signed_by | int unsigned | yes | FK | users.school_id |  |
| signed_at | datetime | yes |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

## AI and audit

### ai_outputs

Stored AI outputs with versions.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | yes | FK | organizations.id |  |
| feature_type | varchar(40) | no |  |  |  |
| reference_type | varchar(40) | yes |  |  |  |
| reference_id | bigint unsigned | yes |  |  |  |
| prompt_text | longtext | yes |  |  |  |
| output_text | longtext | no |  |  |  |
| model_name | varchar(100) | yes |  |  |  |
| context_version | varchar(40) | no |  |  | `v1` |
| structured_input | json | yes |  |  |  |
| structured_output | json | yes |  |  |  |
| status | varchar(20) | no |  |  | `completed` |
| error_message | text | yes |  |  |  |
| version | int unsigned | no |  |  | `1` |
| decision_status | varchar(20) | no |  |  | `pending` |
| requested_by | int unsigned | yes | FK | users.school_id |  |
| decided_by | int unsigned | yes | FK | users.school_id |  |
| decided_at | timestamp | yes |  |  |  |
| created_at | timestamp | no |  |  | `CURRENT_TIMESTAMP` |

### audit_logs

Who did what, when, with old and new values.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| organization_id | bigint unsigned | yes | FK | organizations.id |  |
| user_id | int unsigned | yes | FK | users.school_id |  |
| actor_role | varchar(30) | yes |  |  |  |
| module | varchar(50) | no |  |  |  |
| action | varchar(100) | no |  |  |  |
| description | text | yes |  |  |  |
| record_type | varchar(50) | yes |  |  |  |
| record_id | bigint unsigned | yes |  |  |  |
| old_values | longtext | yes |  |  |  |
| new_values | longtext | yes |  |  |  |
| ip_address | varchar(45) | yes |  |  |  |
| created_at | timestamp | no |  |  | `CURRENT_TIMESTAMP` |

## Evaluation (kept in the database, no user access)

### evaluation_windows

Left over from the removed Evaluation module.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| title | varchar(255) | no |  |  |  |
| description | text | yes |  |  |  |
| opens_at | timestamp | yes |  |  |  |
| closes_at | timestamp | yes |  |  |  |
| status | varchar(20) | no |  |  | `draft` |
| created_by | int unsigned | yes | FK | users.school_id |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

### evaluation_responses

Left over from the removed Evaluation module.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| evaluation_window_id | bigint unsigned | no | FK | evaluation_windows.id |  |
| organization_id | bigint unsigned | no | FK | organizations.id |  |
| user_id | int unsigned | no | FK | users.school_id |  |
| respondent_type | varchar(20) | no |  |  |  |
| consent_given_at | timestamp | yes |  |  |  |
| profile | json | yes |  |  |  |
| answers | json | no |  |  |  |
| feedback | text | yes |  |  |  |
| submitted_at | timestamp | yes |  |  |  |
| created_at | timestamp | yes |  |  |  |
| updated_at | timestamp | yes |  |  |  |

## Framework tables (Laravel internals)

### cache

Cache store.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| key | varchar(255) | no | PK |  |  |
| value | mediumtext | no |  |  |  |
| expiration | int | no |  |  |  |

### cache_locks

Cache locks.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| key | varchar(255) | no | PK |  |  |
| owner | varchar(255) | no |  |  |  |
| expiration | int | no |  |  |  |

### failed_jobs

Failed queue jobs.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| uuid | varchar(255) | no | UQ |  |  |
| connection | text | no |  |  |  |
| queue | text | no |  |  |  |
| payload | longtext | no |  |  |  |
| exception | longtext | no |  |  |  |
| failed_at | timestamp | no |  |  | `CURRENT_TIMESTAMP` |

### job_batches

Queue job batches.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | varchar(255) | no | PK |  |  |
| name | varchar(255) | no |  |  |  |
| total_jobs | int | no |  |  |  |
| pending_jobs | int | no |  |  |  |
| failed_jobs | int | no |  |  |  |
| failed_job_ids | longtext | no |  |  |  |
| options | mediumtext | yes |  |  |  |
| cancelled_at | int | yes |  |  |  |
| created_at | int | no |  |  |  |
| finished_at | int | yes |  |  |  |

### jobs

Queued jobs.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | bigint unsigned | no | PK |  |  |
| queue | varchar(255) | no |  |  |  |
| payload | longtext | no |  |  |  |
| attempts | tinyint unsigned | no |  |  |  |
| reserved_at | int unsigned | yes |  |  |  |
| available_at | int unsigned | no |  |  |  |
| created_at | int unsigned | no |  |  |  |

### migrations

Applied migrations.

| Column | Type | Null | Key | References | Default |
|---|---|---|---|---|---|
| id | int unsigned | no | PK |  |  |
| migration | varchar(255) | no |  |  |  |
| batch | int | no |  |  |  |

