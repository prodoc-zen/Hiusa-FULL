-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1:3306
-- Generation Time: Jul 11, 2026 at 08:26 AM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `hiusa_db`
--

-- --------------------------------------------------------

--
-- Table structure for table `announcements`
--

CREATE TABLE `announcements` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `organization_id` bigint(20) UNSIGNED DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `body` text NOT NULL,
  `created_by` int(10) UNSIGNED DEFAULT NULL,
  `target_role` enum('all','student','officer','adviser') NOT NULL DEFAULT 'all',
  `category` varchar(40) NOT NULL DEFAULT 'general',
  `is_published` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `announcements`
--

INSERT INTO `announcements` (`id`, `organization_id`, `title`, `body`, `created_by`, `target_role`, `category`, `is_published`, `created_at`, `updated_at`) VALUES
(1, 1, 'General Assembly — All Members Required', 'All HIUSA members are required to attend the General Assembly on July 5, 2024 at 2:00 PM in the AVR. Attendance will be checked. Bring your student ID.', 900001, 'all', 'events', 1, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(2, 1, 'Org Fee Collection — Deadline Extended', 'The deadline for organizational fee payment has been extended to June 30. Please settle your ₱500 fee at the HIUSA office. Unpaid members will not receive benefits.', 900001, 'student', 'general', 1, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(3, 1, 'HIUSA Student Council Election 2024–2025 Now Open', 'Voting for the HIUSA Student Council Election is now open! Log in to your student portal and cast your vote before the election closes. Every vote counts.', 900002, 'all', 'election', 1, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(4, 1, 'Sports Fest 2024 — Volunteer Officers Needed', 'We are looking for volunteer officers to assist in the Sports Fest 2024. Duties include venue setup, registration, and logistics. Contact Angela Santos to sign up.', 900002, 'officer', 'events', 1, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(5, 1, 'Uniform Policy Reminder', 'A reminder to all members: proper HIUSA uniform must be worn during all official events. White polo for officers, black slacks for both genders. No exceptions during formal activities.', 900001, 'all', 'general', 1, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(6, 1, 'Sports Fest 2024 — Program Draft', 'Draft program for Sports Fest 2024. Pending review from adviser. Please do not share outside the officer group until approved.', 900002, 'officer', 'events', 0, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(7, 1, 'Q3 Budget Report — Internal Draft', 'Q3 financial summary for internal review. Total income: ₱48,500. Total expenses: ₱31,200. Net: ₱17,300. Pending adviser signature before publishing.', 900001, 'adviser', 'training', 0, '2026-07-10 22:18:59', '2026-07-10 22:18:59');

-- --------------------------------------------------------

--
-- Table structure for table `attendance`
--

CREATE TABLE `attendance` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `event_id` bigint(20) UNSIGNED NOT NULL,
  `user_id` int(10) UNSIGNED NOT NULL,
  `check_in_time` datetime NOT NULL DEFAULT current_timestamp(),
  `method` enum('biometric','manual') NOT NULL DEFAULT 'manual'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `budgets`
--

CREATE TABLE `budgets` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `organization_id` bigint(20) UNSIGNED DEFAULT NULL,
  `event_id` bigint(20) UNSIGNED DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `allocated_amount` decimal(10,2) NOT NULL DEFAULT 0.00,
  `warning_threshold` decimal(10,2) NOT NULL DEFAULT 0.00,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `budgets`
--

INSERT INTO `budgets` (`id`, `organization_id`, `event_id`, `title`, `allocated_amount`, `warning_threshold`, `created_at`, `updated_at`) VALUES
(1, 1, NULL, 'General Operations Fund', 50000.00, 10000.00, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(2, 1, 3, 'Sports Fest 2024 Budget', 25000.00, 5000.00, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(3, 1, NULL, 'Merchandise Fund', 30000.00, 8000.00, '2026-07-10 22:18:59', '2026-07-10 22:18:59');

-- --------------------------------------------------------

--
-- Table structure for table `cache`
--

CREATE TABLE `cache` (
  `key` varchar(255) NOT NULL,
  `value` mediumtext NOT NULL,
  `expiration` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `cache_locks`
--

CREATE TABLE `cache_locks` (
  `key` varchar(255) NOT NULL,
  `owner` varchar(255) NOT NULL,
  `expiration` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `candidates`
--

CREATE TABLE `candidates` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `election_id` bigint(20) UNSIGNED NOT NULL,
  `user_id` int(10) UNSIGNED NOT NULL,
  `position_id` bigint(20) UNSIGNED NOT NULL,
  `platform` text DEFAULT NULL,
  `image_url` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `partylist_id` bigint(20) UNSIGNED DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `candidates`
--

INSERT INTO `candidates` (`id`, `election_id`, `user_id`, `position_id`, `platform`, `image_url`, `created_at`, `updated_at`, `partylist_id`) VALUES
(1, 1, 2100142, 1, 'I will push for better student services, transparent finances, and stronger industry partnerships for HIUSA members.', NULL, '2026-07-10 22:18:59', '2026-07-10 22:18:59', 1),
(2, 1, 2100217, 1, 'My platform focuses on digitalizing HIUSA processes, reducing paperwork, and making governance accessible to every student.', NULL, '2026-07-10 22:18:59', '2026-07-10 22:18:59', 2),
(3, 1, 2100389, 2, 'I will support the president in event coordination, member welfare, and maintaining strong adviser relations.', NULL, '2026-07-10 22:18:59', '2026-07-10 22:18:59', 1),
(4, 1, 2200055, 2, 'As VP, I will champion new student initiatives, mentorship programs, and better communication between officers and students.', NULL, '2026-07-10 22:18:59', '2026-07-10 22:18:59', 2);

-- --------------------------------------------------------

--
-- Table structure for table `elections`
--

CREATE TABLE `elections` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `organization_id` bigint(20) UNSIGNED DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `start_time` datetime NOT NULL,
  `end_time` datetime NOT NULL,
  `status` enum('upcoming','active','closed') NOT NULL DEFAULT 'upcoming',
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `elections`
--

INSERT INTO `elections` (`id`, `organization_id`, `title`, `start_time`, `end_time`, `status`, `created_at`, `updated_at`) VALUES
(1, 1, 'HIUSA Student Council Election 2024–2025', '2026-07-10 06:18:59', '2026-07-18 06:18:59', 'active', '2026-07-10 22:18:59', '2026-07-10 22:18:59');

-- --------------------------------------------------------

--
-- Table structure for table `election_positions`
--

CREATE TABLE `election_positions` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `election_id` bigint(20) UNSIGNED NOT NULL,
  `title` varchar(100) NOT NULL,
  `max_winners` int(11) NOT NULL DEFAULT 1,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `election_positions`
--

INSERT INTO `election_positions` (`id`, `election_id`, `title`, `max_winners`, `created_at`, `updated_at`) VALUES
(1, 1, 'President', 1, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(2, 1, 'Vice President', 1, '2026-07-10 22:18:59', '2026-07-10 22:18:59');

-- --------------------------------------------------------

--
-- Table structure for table `events`
--

CREATE TABLE `events` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `organization_id` bigint(20) UNSIGNED DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `start_time` datetime NOT NULL,
  `end_time` datetime NOT NULL,
  `location` varchar(255) DEFAULT NULL,
  `status` enum('planning','approved','ongoing','completed','cancelled') NOT NULL DEFAULT 'planning',
  `created_by` int(10) UNSIGNED NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `events`
--

INSERT INTO `events` (`id`, `organization_id`, `title`, `description`, `start_time`, `end_time`, `location`, `status`, `created_by`, `created_at`, `updated_at`) VALUES
(1, 1, 'HIUSA General Assembly', 'Mandatory general assembly for all HIUSA members. Agenda includes election results, budget presentation, and Q&A session.', '2026-06-27 14:00:00', '2026-06-27 17:00:00', 'Audio-Visual Room, 3rd Floor Main Building', 'completed', 900001, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(2, 1, 'Leadership Seminar 2024', 'Two-day leadership and governance seminar for all HIUSA officers. Topics include project management, conflict resolution, and financial accountability.', '2026-07-10 08:00:00', '2026-07-12 17:00:00', 'Hotel Veneto, Iloilo City', 'ongoing', 900001, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(3, 1, 'Sports Fest 2024', 'Annual HIUSA Sports Fest featuring basketball, volleyball, and badminton tournaments. Open to all registered HIUSA members.', '2026-07-25 07:00:00', '2026-07-26 18:00:00', 'University Gymnasium', 'approved', 900001, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(4, 1, 'Induction and Recognition Ceremony', 'Formal induction of newly elected HIUSA officers and recognition of outstanding members for the academic year 2024–2025.', '2026-08-11 17:00:00', '2026-08-11 21:00:00', 'University Convention Center', 'approved', 900001, '2026-07-10 22:18:59', '2026-07-10 22:18:59');

-- --------------------------------------------------------

--
-- Table structure for table `failed_jobs`
--

CREATE TABLE `failed_jobs` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `uuid` varchar(255) NOT NULL,
  `connection` text NOT NULL,
  `queue` text NOT NULL,
  `payload` longtext NOT NULL,
  `exception` longtext NOT NULL,
  `failed_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `financial_forecasts`
--

CREATE TABLE `financial_forecasts` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `organization_id` bigint(20) UNSIGNED DEFAULT NULL,
  `forecast_period` varchar(50) NOT NULL,
  `predicted_income` decimal(10,2) NOT NULL,
  `predicted_expense` decimal(10,2) NOT NULL,
  `confidence_note` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `financial_forecasts`
--

INSERT INTO `financial_forecasts` (`id`, `organization_id`, `forecast_period`, `predicted_income`, `predicted_expense`, `confidence_note`, `created_at`, `updated_at`) VALUES
(1, 1, 'Q3 2024 (Jul–Sep)', 20000.00, 15000.00, 'Based on previous semester patterns. Includes Sports Fest and Induction expenses.', '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(2, 1, 'Q4 2024 (Oct–Dec)', 22000.00, 18500.00, 'Semester-end period. Higher expected expenses for Recognition ceremony and year-end activities.', '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(3, 1, 'Q1 2025 (Jan–Mar)', 15000.00, 12000.00, 'New semester org fee collection expected. Lower expenses in early semester.', '2026-07-10 22:18:59', '2026-07-10 22:18:59');

-- --------------------------------------------------------

--
-- Table structure for table `jobs`
--

CREATE TABLE `jobs` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `queue` varchar(255) NOT NULL,
  `payload` longtext NOT NULL,
  `attempts` tinyint(3) UNSIGNED NOT NULL,
  `reserved_at` int(10) UNSIGNED DEFAULT NULL,
  `available_at` int(10) UNSIGNED NOT NULL,
  `created_at` int(10) UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `job_batches`
--

CREATE TABLE `job_batches` (
  `id` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `total_jobs` int(11) NOT NULL,
  `pending_jobs` int(11) NOT NULL,
  `failed_jobs` int(11) NOT NULL,
  `failed_job_ids` longtext NOT NULL,
  `options` mediumtext DEFAULT NULL,
  `cancelled_at` int(11) DEFAULT NULL,
  `created_at` int(11) NOT NULL,
  `finished_at` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `merchandise`
--

CREATE TABLE `merchandise` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `organization_id` bigint(20) UNSIGNED DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `category` varchar(100) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `price` decimal(10,2) NOT NULL,
  `stock_quantity` int(11) NOT NULL DEFAULT 0,
  `image_url` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `merchandise`
--

INSERT INTO `merchandise` (`id`, `organization_id`, `name`, `category`, `description`, `price`, `stock_quantity`, `image_url`, `is_active`, `created_at`, `updated_at`) VALUES
(1, 1, 'HIUSA T-Shirt (S/M)', 'Apparel', 'Official HIUSA organization shirt. Light blue with embroidered HIUSA logo on the chest. Available in Small and Medium.', 250.00, 45, NULL, 1, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(2, 1, 'HIUSA T-Shirt (L/XL)', 'Apparel', 'Official HIUSA organization shirt. Light blue with embroidered HIUSA logo on the chest. Available in Large and Extra-Large.', 250.00, 30, NULL, 1, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(3, 1, 'HIUSA Tote Bag', 'Accessories', 'Reusable canvas tote bag with HIUSA logo print. Dimensions: 35cm × 38cm. Natural beige color.', 180.00, 20, NULL, 1, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(4, 1, 'HIUSA Lanyard', 'Accessories', 'Durable polyester lanyard with HIUSA branding and metal clip. Standard length 45cm. Navy blue.', 75.00, 8, NULL, 1, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(5, 1, 'HIUSA Notebook (A5)', 'Stationery', 'Soft-cover A5 ruled notebook with HIUSA logo on the cover. 120 pages. Currently out of stock — reorder in progress.', 120.00, 0, NULL, 1, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(6, 1, 'HIUSA Cap', 'Apparel', 'Adjustable baseball cap with embroidered HIUSA logo. Navy blue. Currently delisted pending new design.', 350.00, 15, NULL, 0, '2026-07-10 22:18:59', '2026-07-10 22:18:59');

-- --------------------------------------------------------

--
-- Table structure for table `migrations`
--

CREATE TABLE `migrations` (
  `id` int(10) UNSIGNED NOT NULL,
  `migration` varchar(255) NOT NULL,
  `batch` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `migrations`
--

INSERT INTO `migrations` (`id`, `migration`, `batch`) VALUES
(1, '0000_12_31_235959_create_organizations_table', 1),
(2, '0001_01_01_000000_create_users_table', 1),
(3, '0001_01_01_000001_create_cache_table', 1),
(4, '0001_01_01_000002_create_jobs_table', 1),
(5, '2026_06_22_144049_create_announcements_table', 1),
(6, '2026_06_22_144050_create_events_table', 1),
(7, '2026_06_22_144050_create_tasks_table', 1),
(8, '2026_06_22_144051_create_budgets_table', 1),
(9, '2026_06_22_144051_create_financial_forecasts_table', 1),
(10, '2026_06_22_144052_create_merchandise_table', 1),
(11, '2026_06_22_144052_create_orders_table', 1),
(12, '2026_06_22_144052_create_transactions_table', 1),
(13, '2026_06_22_144053_create_elections_table', 1),
(14, '2026_06_22_144054_create_election_positions_table', 1),
(15, '2026_06_22_144055_create_candidates_table', 1),
(16, '2026_06_22_144056_create_notifications_table', 1),
(17, '2026_06_22_144056_create_votes_table', 1),
(18, '2026_06_22_144057_create_attendance_table', 1),
(19, '2026_06_22_144945_create_personal_access_tokens_table', 1),
(20, '2026_06_24_141112_create_partylists_table', 1),
(21, '2026_06_24_141119_add_partylist_id_to_candidates_table', 1),
(22, '2026_06_27_000001_add_performance_indexes', 1),
(23, '2026_06_28_000001_add_banner_url_to_partylists_table', 1),
(24, '2026_07_04_000001_add_category_to_announcements_table', 1),
(25, '2026_07_08_000001_add_organization_id_to_system_tables', 1);

-- --------------------------------------------------------

--
-- Table structure for table `notifications`
--

CREATE TABLE `notifications` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `organization_id` bigint(20) UNSIGNED DEFAULT NULL,
  `user_id` int(10) UNSIGNED NOT NULL,
  `title` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `is_read` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `orders`
--

CREATE TABLE `orders` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `organization_id` bigint(20) UNSIGNED DEFAULT NULL,
  `student_id` int(10) UNSIGNED NOT NULL,
  `merchandise_id` bigint(20) UNSIGNED NOT NULL,
  `quantity` int(11) NOT NULL DEFAULT 1,
  `total_price` decimal(10,2) NOT NULL,
  `status` enum('pending','paid','claimed','cancelled') NOT NULL DEFAULT 'pending',
  `claim_token` varchar(50) NOT NULL,
  `processed_by` int(10) UNSIGNED DEFAULT NULL,
  `approved_by` int(10) UNSIGNED DEFAULT NULL,
  `claimed_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `organizations`
--

CREATE TABLE `organizations` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `name` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `college` varchar(255) DEFAULT NULL,
  `acronym` varchar(50) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `organizations`
--

INSERT INTO `organizations` (`id`, `name`, `slug`, `college`, `acronym`, `is_active`, `created_at`, `updated_at`) VALUES
(1, 'Philippine Society of Information Technology Students - College of Computer Studies', 'philippine-society-of-information-technology-students-college-of-computer-studies', 'College of Computer Studies', 'PSITS-CCS', 1, '2026-07-10 22:18:53', '2026-07-10 22:18:53'),
(2, 'Junior Philippine Institute of Accountants - College of Business Education', 'junior-philippine-institute-of-accountants-college-of-business-education', 'College of Business Education', 'JPIA-CBE', 1, '2026-07-10 22:18:53', '2026-07-10 22:18:53'),
(3, 'Future Educators Society - College of Teacher Education', 'future-educators-society-college-of-teacher-education', 'College of Teacher Education', 'FES-CTE', 1, '2026-07-10 22:18:53', '2026-07-10 22:18:53'),
(4, 'Nursing Student Council - College of Health Sciences', 'nursing-student-council-college-of-health-sciences', 'College of Health Sciences', 'NSC-CHS', 1, '2026-07-10 22:18:53', '2026-07-10 22:18:53'),
(5, 'Engineering Innovators Guild - College of Engineering', 'engineering-innovators-guild-college-of-engineering', 'College of Engineering', 'EIG-COE', 1, '2026-07-10 22:18:53', '2026-07-10 22:18:53');

-- --------------------------------------------------------

--
-- Table structure for table `partylists`
--

CREATE TABLE `partylists` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `organization_id` bigint(20) UNSIGNED DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `acronym` varchar(255) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `banner_url` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `partylists`
--

INSERT INTO `partylists` (`id`, `organization_id`, `name`, `acronym`, `description`, `banner_url`, `created_at`, `updated_at`) VALUES
(1, 1, 'Unity Party', 'UP', 'Committed to inclusive governance, transparency, and student welfare.', NULL, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(2, 1, 'Progress Alliance', 'PA', 'Focused on modernizing HIUSA operations and digital student services.', NULL, '2026-07-10 22:18:59', '2026-07-10 22:18:59');

-- --------------------------------------------------------

--
-- Table structure for table `password_reset_tokens`
--

CREATE TABLE `password_reset_tokens` (
  `email` varchar(255) NOT NULL,
  `token` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `personal_access_tokens`
--

CREATE TABLE `personal_access_tokens` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `tokenable_type` varchar(255) NOT NULL,
  `tokenable_id` bigint(20) UNSIGNED NOT NULL,
  `name` text NOT NULL,
  `token` varchar(64) NOT NULL,
  `abilities` text DEFAULT NULL,
  `last_used_at` timestamp NULL DEFAULT NULL,
  `expires_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `personal_access_tokens`
--

INSERT INTO `personal_access_tokens` (`id`, `tokenable_type`, `tokenable_id`, `name`, `token`, `abilities`, `last_used_at`, `expires_at`, `created_at`, `updated_at`) VALUES
(1, 'App\\Models\\User', 900001, 'auth_token', '6d4e57ad165d8de2d31ad38b5aec4acecb067687bfd75b8b93cf0f85e768b79c', '[\"*\"]', '2026-07-10 22:24:26', NULL, '2026-07-10 22:23:44', '2026-07-10 22:24:26');

-- --------------------------------------------------------

--
-- Table structure for table `sessions`
--

CREATE TABLE `sessions` (
  `id` varchar(255) NOT NULL,
  `user_id` int(10) UNSIGNED DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `payload` longtext NOT NULL,
  `last_activity` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `tasks`
--

CREATE TABLE `tasks` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `organization_id` bigint(20) UNSIGNED DEFAULT NULL,
  `event_id` bigint(20) UNSIGNED DEFAULT NULL,
  `created_by` int(10) UNSIGNED NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `assigned_to` int(10) UNSIGNED DEFAULT NULL,
  `status` enum('pending','in_progress','completed','overdue') NOT NULL DEFAULT 'pending',
  `deadline` datetime NOT NULL,
  `ai_recommendation_note` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `tasks`
--

INSERT INTO `tasks` (`id`, `organization_id`, `event_id`, `created_by`, `title`, `description`, `assigned_to`, `status`, `deadline`, `ai_recommendation_note`, `created_at`, `updated_at`) VALUES
(1, 1, 1, 900001, 'Prepare event venue layout for General Assembly', 'Arrange chairs, set up projector and sound system, print attendance sheets.', 900002, 'completed', '2026-06-26 06:18:59', NULL, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(2, 1, 1, 900001, 'Book catering for General Assembly', 'Source and confirm snack catering for approximately 80 attendees.', 900001, 'completed', '2026-06-24 06:18:59', NULL, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(3, 1, NULL, 900001, 'Design and print election campaign posters', 'Coordinate with candidates for photos and platform summaries. Print 20 copies per candidate.', 900002, 'in_progress', '2026-07-12 06:18:59', NULL, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(4, 1, NULL, 900001, 'Collect and record second semester org fee payments', 'Accept payments from students, issue official receipts, update payment records in system.', 900001, 'in_progress', '2026-07-18 06:18:59', NULL, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(5, 1, NULL, 900001, 'Draft semester-end financial report', 'Compile all transaction records, prepare income vs expense summary, get adviser signature.', 900001, 'pending', '2026-07-25 06:18:59', NULL, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(6, 1, 3, 900001, 'Source merchandise suppliers for Sports Fest', 'Get at least 3 quotations for HIUSA shirts, lanyards, and tote bags. Present to president by deadline.', 900002, 'pending', '2026-08-01 06:18:59', NULL, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(7, 1, NULL, 900001, 'Update official member roster for 2024–2025', 'Cross-check paid members list with registration records. Remove inactive members from the roster.', 900002, 'overdue', '2026-07-06 06:18:59', NULL, '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(8, 1, NULL, 900001, 'Follow up unpaid organizational fee list', 'Send reminders to students with outstanding org fees. Coordinate with class representatives.', 900001, 'overdue', '2026-07-04 06:18:59', NULL, '2026-07-10 22:18:59', '2026-07-10 22:18:59');

-- --------------------------------------------------------

--
-- Table structure for table `transactions`
--

CREATE TABLE `transactions` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `organization_id` bigint(20) UNSIGNED DEFAULT NULL,
  `budget_id` bigint(20) UNSIGNED DEFAULT NULL,
  `recorded_by` int(10) UNSIGNED NOT NULL,
  `type` enum('income','expense') NOT NULL,
  `category` varchar(100) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `description` text NOT NULL,
  `receipt_reference` varchar(100) DEFAULT NULL,
  `transaction_date` datetime NOT NULL DEFAULT current_timestamp(),
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `transactions`
--

INSERT INTO `transactions` (`id`, `organization_id`, `budget_id`, `recorded_by`, `type`, `category`, `amount`, `description`, `receipt_reference`, `transaction_date`, `created_at`, `updated_at`) VALUES
(1, 1, 1, 900001, 'income', 'Org Fee', 18500.00, 'First semester organizational fee collection — 37 members', NULL, '2026-04-01 00:00:00', '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(2, 1, 1, 900001, 'income', 'Org Fee', 15000.00, 'Second semester organizational fee collection — 30 members', NULL, '2026-06-01 00:00:00', '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(3, 1, 1, 900001, 'income', 'Sponsorship', 10000.00, 'Corporate sponsorship from TechPH — Sports Fest', NULL, '2026-05-11 06:18:59', '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(4, 1, 3, 900001, 'income', 'Merchandise Sales', 8750.00, 'First batch merchandise revenue — shirts and lanyards', NULL, '2026-06-20 06:18:59', '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(5, 1, 1, 900001, 'expense', 'Venue', 5000.00, 'AVR rental for General Assembly — 3 hours', NULL, '2026-06-20 06:18:59', '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(6, 1, 1, 900001, 'expense', 'Food & Catering', 4500.00, 'Snacks and drinks for General Assembly — 80 pax', NULL, '2026-06-27 06:18:59', '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(7, 1, 1, 900001, 'expense', 'Printing', 2200.00, 'Tarpaulins, programs, and attendance sheets', NULL, '2026-06-25 06:18:59', '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(8, 1, 2, 900001, 'expense', 'Supplies', 3800.00, 'Sports equipment and medals — basketball, volleyball', NULL, '2026-07-04 06:18:59', '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(9, 1, 3, 900001, 'expense', 'Merchandise', 12500.00, 'Merchandise procurement — 50 shirts, 30 tote bags, 100 lanyards', NULL, '2026-05-11 06:18:59', '2026-07-10 22:18:59', '2026-07-10 22:18:59'),
(10, 1, 1, 900001, 'expense', 'Transport', 1800.00, 'Van rental for Leadership Seminar — round trip', NULL, '2026-07-09 06:18:59', '2026-07-10 22:18:59', '2026-07-10 22:18:59');

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `school_id` int(10) UNSIGNED NOT NULL,
  `first_name` varchar(60) NOT NULL,
  `last_name` varchar(60) NOT NULL,
  `is_member` tinyint(1) NOT NULL DEFAULT 0,
  `email` varchar(100) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` enum('student','officer','admin','adviser') NOT NULL DEFAULT 'student',
  `biometric_template` longblob DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `organization_id` bigint(20) UNSIGNED NOT NULL
) ;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`school_id`, `first_name`, `last_name`, `is_member`, `email`, `password_hash`, `role`, `biometric_template`, `created_at`, `updated_at`, `organization_id`) VALUES
(900001, 'Marco', 'Dela Cruz', 1, 'officer1@hiusa.local', '$2y$12$pGhZExZRB/7vB9RQYKPzo./wmMvYthtaA4XtnQKFObkLtupR9gime', 'officer', NULL, '2026-07-10 22:18:54', '2026-07-10 22:18:54', 1),
(900002, 'Angela', 'Santos', 1, 'officer2@hiusa.local', '$2y$12$LkQPguEKPghU69bO9xP2Xe9/jrDcOxI8AA2M5J0KKpSek/Zw0.EG6', 'officer', NULL, '2026-07-10 22:18:54', '2026-07-10 22:18:54', 1),
(910001, 'Ricardo', 'Lim', 1, 'adviser1@hiusa.local', '$2y$12$HHnp8kPnWXXDrRrz0ftO9.M9XpXWyyDwWCs8EDRVd3SW9rDRqo/FG', 'adviser', NULL, '2026-07-10 22:18:54', '2026-07-10 22:18:54', 1),
(910002, 'Maria', 'Reyes', 1, 'adviser2@hiusa.local', '$2y$12$uFUCLOfG4NoCZ5UB/FgOhe4qZxELuhZabmKm2B10j5mT430C3BuAa', 'adviser', NULL, '2026-07-10 22:18:55', '2026-07-10 22:18:55', 1),
(920011, 'Mika', 'Salcedo', 1, 'mika.salcedo@cbe.hiusa.local', '$2y$12$kKy9ReCAw0kSDjZR.HpTMuJ62CVxENOdDWPl55r6uJRaSr/t5Icfm', 'officer', NULL, '2026-07-10 22:18:58', '2026-07-10 22:18:58', 2),
(930027, 'Elena', 'Soriano', 1, 'elena.soriano@chs.hiusa.local', '$2y$12$AQqpth8fP5PbokVAvW7FAOp9R1JNUMduLTGMwSZWGHkieyEO8IOK6', 'adviser', NULL, '2026-07-10 22:18:59', '2026-07-10 22:18:59', 4),
(990001, 'System', 'Administrator', 0, 'admin@hiusa.local', '$2y$12$npT./G..pN0QMPWYIaui1u5MaAflHt92dYEKxD7LTnO8iKunyVqlK', 'admin', NULL, '2026-07-10 22:18:54', '2026-07-10 22:18:54', 1),
(2100142, 'Juan', 'Dela Vega', 1, 'juan.delavega@student.hiusa.local', '$2y$12$IBQ81DagpGrio.V0/cqGp.dlMd/HVlC69GSz9XHfKu0Z4GXuEfLCi', 'student', NULL, '2026-07-10 22:18:55', '2026-07-10 22:18:55', 1),
(2100217, 'Sofia', 'Bautista', 1, 'sofia.bautista@student.hiusa.local', '$2y$12$rDTQeTDGc8ZngVbT/nbXXuFI/FaszC6W524asIjGAB4KTfIUSHcUm', 'student', NULL, '2026-07-10 22:18:55', '2026-07-10 22:18:55', 1),
(2100389, 'Carlo', 'Mendoza', 1, 'carlo.mendoza@student.hiusa.local', '$2y$12$ZDtE.HT9HHA.4C0c427MZerl0G5uiLH/5h/xytcMaQMaR/8CQV6Ca', 'student', NULL, '2026-07-10 22:18:55', '2026-07-10 22:18:55', 1),
(2200055, 'Pia', 'Torres', 1, 'pia.torres@student.hiusa.local', '$2y$12$OhWIOIFLcS5z2BHSPXnaVuiYk6cNBvigNt0uspzG80asEXkhxve/i', 'student', NULL, '2026-07-10 22:18:56', '2026-07-10 22:18:56', 1),
(2200134, 'Luis', 'Ramos', 1, 'luis.ramos@student.hiusa.local', '$2y$12$fYCxMycxyX39itOgdgZ/su2Tr.60SKcx.ELxsTGgC7UxOU3fEx6gG', 'student', NULL, '2026-07-10 22:18:56', '2026-07-10 22:18:56', 1),
(2200298, 'Gabrielle', 'Villanueva', 1, 'gabrielle.villanueva@student.hiusa.local', '$2y$12$wcv5n8egLWmoy6gk3KgXhOhd9lxdKPPLY04kfKLgSCem/Fl8duKN2', 'student', NULL, '2026-07-10 22:18:56', '2026-07-10 22:18:56', 1),
(2200451, 'Rafael', 'Aquino', 1, 'rafael.aquino@student.hiusa.local', '$2y$12$Az.pD8M/X4C80FeMuOog8OOIQHb.AIBd028NkJPsGQfda888AjwSW', 'student', NULL, '2026-07-10 22:18:56', '2026-07-10 22:18:56', 1),
(2300078, 'Camille', 'Garcia', 1, 'camille.garcia@student.hiusa.local', '$2y$12$6Rl09OjE7tQgQ3uMZk4jyOyxs3QemcajcmPoHrDoEs3.V5M/lDdVq', 'student', NULL, '2026-07-10 22:18:57', '2026-07-10 22:18:57', 1),
(2300163, 'Andrei', 'Navarro', 1, 'andrei.navarro@student.hiusa.local', '$2y$12$V2leH3DmE.jZZowEx9Clx.gg1/0z3RU.1kqxb7DZSN3k7zC7xQr5K', 'student', NULL, '2026-07-10 22:18:57', '2026-07-10 22:18:57', 1),
(2300247, 'Beatrice', 'Castillo', 1, 'beatrice.castillo@student.hiusa.local', '$2y$12$YXMvsjEtoaPDejH.kbbeSeuM.lKWjw5217KMxUB9Y6dAhRTrDQYlu', 'student', NULL, '2026-07-10 22:18:57', '2026-07-10 22:18:57', 1),
(2300312, 'Miguel', 'Pascual', 1, 'miguel.pascual@student.hiusa.local', '$2y$12$q/QpW6Visl9LgQzvdSD1VuP.jZ/qkew9mYCi6AEJ9djjExyAvpjsK', 'student', NULL, '2026-07-10 22:18:57', '2026-07-10 22:18:57', 1),
(2400019, 'Trisha', 'Herrera', 1, 'trisha.herrera@student.hiusa.local', '$2y$12$odEb2xKdyf/HyehxkYhBQecmMvt99scDLkT548aORSp93T9KwAp6u', 'student', NULL, '2026-07-10 22:18:58', '2026-07-10 22:18:58', 1),
(2400067, 'Jerome', 'Evangelista', 1, 'jerome.evangelista@student.hiusa.local', '$2y$12$f7jI1c5AsokyuAibDa2iF.Pydmvmy6HaFYPE8cFrgfvJNHncFZaIy', 'student', NULL, '2026-07-10 22:18:58', '2026-07-10 22:18:58', 1),
(2400093, 'Alyssa', 'Domingo', 1, 'alyssa.domingo@student.hiusa.local', '$2y$12$/AAHVchitDEL31hpdj2X0OSyYiMpMrBC/mIedLtk.udA8ZkFknSAi', 'student', NULL, '2026-07-10 22:18:58', '2026-07-10 22:18:58', 1),
(2400118, 'Nico', 'Valdez', 1, 'nico.valdez@cte.hiusa.local', '$2y$12$kPeMDC/VgRRIs2QE8sFUIOTeMecdCXFdhbgxZATh74xAsTzyBrK3S', 'student', NULL, '2026-07-10 22:18:58', '2026-07-10 22:18:58', 3),
(2400133, 'Paolo', 'Marquez', 1, 'paolo.marquez@coe.hiusa.local', '$2y$12$9qOmMgsStknbTUdT3F8pEOB836aQha9PbcyaXTW8kZoTkCsNiYAeu', 'student', NULL, '2026-07-10 22:18:59', '2026-07-10 22:18:59', 5);

-- --------------------------------------------------------

--
-- Table structure for table `votes`
--

CREATE TABLE `votes` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `election_id` bigint(20) UNSIGNED NOT NULL,
  `position_id` bigint(20) UNSIGNED NOT NULL,
  `candidate_id` bigint(20) UNSIGNED NOT NULL,
  `voter_id` int(10) UNSIGNED NOT NULL,
  `vote_hash` varchar(255) NOT NULL,
  `cast_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `announcements`
--
ALTER TABLE `announcements`
  ADD PRIMARY KEY (`id`),
  ADD KEY `announcements_created_by_foreign` (`created_by`),
  ADD KEY `announcements_published_role_index` (`is_published`,`target_role`),
  ADD KEY `announcements_organization_id_index` (`organization_id`);

--
-- Indexes for table `attendance`
--
ALTER TABLE `attendance`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_attendance` (`event_id`,`user_id`),
  ADD KEY `attendance_user_id_foreign` (`user_id`);

--
-- Indexes for table `budgets`
--
ALTER TABLE `budgets`
  ADD PRIMARY KEY (`id`),
  ADD KEY `budgets_event_id_foreign` (`event_id`),
  ADD KEY `budgets_organization_id_index` (`organization_id`);

--
-- Indexes for table `cache`
--
ALTER TABLE `cache`
  ADD PRIMARY KEY (`key`),
  ADD KEY `cache_expiration_index` (`expiration`);

--
-- Indexes for table `cache_locks`
--
ALTER TABLE `cache_locks`
  ADD PRIMARY KEY (`key`),
  ADD KEY `cache_locks_expiration_index` (`expiration`);

--
-- Indexes for table `candidates`
--
ALTER TABLE `candidates`
  ADD PRIMARY KEY (`id`),
  ADD KEY `candidates_election_id_foreign` (`election_id`),
  ADD KEY `candidates_position_id_foreign` (`position_id`),
  ADD KEY `candidates_user_id_foreign` (`user_id`),
  ADD KEY `candidates_partylist_id_foreign` (`partylist_id`);

--
-- Indexes for table `elections`
--
ALTER TABLE `elections`
  ADD PRIMARY KEY (`id`),
  ADD KEY `elections_organization_id_index` (`organization_id`);

--
-- Indexes for table `election_positions`
--
ALTER TABLE `election_positions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `election_positions_election_id_foreign` (`election_id`);

--
-- Indexes for table `events`
--
ALTER TABLE `events`
  ADD PRIMARY KEY (`id`),
  ADD KEY `events_created_by_foreign` (`created_by`),
  ADD KEY `events_status_start_index` (`status`,`start_time`),
  ADD KEY `events_organization_id_index` (`organization_id`);

--
-- Indexes for table `failed_jobs`
--
ALTER TABLE `failed_jobs`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `failed_jobs_uuid_unique` (`uuid`);

--
-- Indexes for table `financial_forecasts`
--
ALTER TABLE `financial_forecasts`
  ADD PRIMARY KEY (`id`),
  ADD KEY `financial_forecasts_organization_id_index` (`organization_id`);

--
-- Indexes for table `jobs`
--
ALTER TABLE `jobs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `jobs_queue_index` (`queue`);

--
-- Indexes for table `job_batches`
--
ALTER TABLE `job_batches`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `merchandise`
--
ALTER TABLE `merchandise`
  ADD PRIMARY KEY (`id`),
  ADD KEY `merchandise_organization_id_index` (`organization_id`);

--
-- Indexes for table `migrations`
--
ALTER TABLE `migrations`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `notifications`
--
ALTER TABLE `notifications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `notifications_user_id_foreign` (`user_id`),
  ADD KEY `notifications_organization_id_index` (`organization_id`);

--
-- Indexes for table `orders`
--
ALTER TABLE `orders`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `orders_claim_token_unique` (`claim_token`),
  ADD KEY `orders_merchandise_id_foreign` (`merchandise_id`),
  ADD KEY `orders_processed_by_foreign` (`processed_by`),
  ADD KEY `orders_approved_by_foreign` (`approved_by`),
  ADD KEY `orders_student_status_index` (`student_id`,`status`),
  ADD KEY `orders_organization_id_index` (`organization_id`);

--
-- Indexes for table `organizations`
--
ALTER TABLE `organizations`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `organizations_name_unique` (`name`),
  ADD UNIQUE KEY `organizations_slug_unique` (`slug`);

--
-- Indexes for table `partylists`
--
ALTER TABLE `partylists`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `partylists_organization_name_unique` (`organization_id`,`name`),
  ADD KEY `partylists_organization_id_index` (`organization_id`);

--
-- Indexes for table `password_reset_tokens`
--
ALTER TABLE `password_reset_tokens`
  ADD PRIMARY KEY (`email`);

--
-- Indexes for table `personal_access_tokens`
--
ALTER TABLE `personal_access_tokens`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `personal_access_tokens_token_unique` (`token`),
  ADD KEY `personal_access_tokens_tokenable_type_tokenable_id_index` (`tokenable_type`,`tokenable_id`),
  ADD KEY `personal_access_tokens_expires_at_index` (`expires_at`);

--
-- Indexes for table `sessions`
--
ALTER TABLE `sessions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `sessions_user_id_index` (`user_id`),
  ADD KEY `sessions_last_activity_index` (`last_activity`);

--
-- Indexes for table `tasks`
--
ALTER TABLE `tasks`
  ADD PRIMARY KEY (`id`),
  ADD KEY `tasks_event_id_foreign` (`event_id`),
  ADD KEY `tasks_created_by_foreign` (`created_by`),
  ADD KEY `tasks_assigned_status_index` (`assigned_to`,`status`),
  ADD KEY `tasks_organization_id_index` (`organization_id`);

--
-- Indexes for table `transactions`
--
ALTER TABLE `transactions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `transactions_receipt_reference_unique` (`receipt_reference`),
  ADD KEY `transactions_budget_id_foreign` (`budget_id`),
  ADD KEY `transactions_recorded_by_foreign` (`recorded_by`),
  ADD KEY `transactions_organization_id_index` (`organization_id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`school_id`),
  ADD UNIQUE KEY `users_organization_email_unique` (`organization_id`,`email`),
  ADD KEY `users_organization_id_index` (`organization_id`);

--
-- Indexes for table `votes`
--
ALTER TABLE `votes`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_vote_per_position` (`election_id`,`position_id`,`voter_id`),
  ADD UNIQUE KEY `votes_vote_hash_unique` (`vote_hash`),
  ADD KEY `votes_position_id_foreign` (`position_id`),
  ADD KEY `votes_candidate_id_foreign` (`candidate_id`),
  ADD KEY `votes_voter_id_foreign` (`voter_id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `announcements`
--
ALTER TABLE `announcements`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

--
-- AUTO_INCREMENT for table `attendance`
--
ALTER TABLE `attendance`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `budgets`
--
ALTER TABLE `budgets`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `candidates`
--
ALTER TABLE `candidates`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `elections`
--
ALTER TABLE `elections`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `election_positions`
--
ALTER TABLE `election_positions`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `events`
--
ALTER TABLE `events`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `failed_jobs`
--
ALTER TABLE `failed_jobs`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `financial_forecasts`
--
ALTER TABLE `financial_forecasts`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `jobs`
--
ALTER TABLE `jobs`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `merchandise`
--
ALTER TABLE `merchandise`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `migrations`
--
ALTER TABLE `migrations`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=26;

--
-- AUTO_INCREMENT for table `notifications`
--
ALTER TABLE `notifications`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `orders`
--
ALTER TABLE `orders`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `organizations`
--
ALTER TABLE `organizations`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `partylists`
--
ALTER TABLE `partylists`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `personal_access_tokens`
--
ALTER TABLE `personal_access_tokens`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `tasks`
--
ALTER TABLE `tasks`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=9;

--
-- AUTO_INCREMENT for table `transactions`
--
ALTER TABLE `transactions`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=11;

--
-- AUTO_INCREMENT for table `votes`
--
ALTER TABLE `votes`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `announcements`
--
ALTER TABLE `announcements`
  ADD CONSTRAINT `announcements_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users` (`school_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `announcements_organization_id_foreign` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `attendance`
--
ALTER TABLE `attendance`
  ADD CONSTRAINT `attendance_event_id_foreign` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `attendance_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`school_id`) ON DELETE CASCADE;

--
-- Constraints for table `budgets`
--
ALTER TABLE `budgets`
  ADD CONSTRAINT `budgets_event_id_foreign` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `budgets_organization_id_foreign` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `candidates`
--
ALTER TABLE `candidates`
  ADD CONSTRAINT `candidates_election_id_foreign` FOREIGN KEY (`election_id`) REFERENCES `elections` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `candidates_partylist_id_foreign` FOREIGN KEY (`partylist_id`) REFERENCES `partylists` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `candidates_position_id_foreign` FOREIGN KEY (`position_id`) REFERENCES `election_positions` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `candidates_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`school_id`) ON DELETE CASCADE;

--
-- Constraints for table `elections`
--
ALTER TABLE `elections`
  ADD CONSTRAINT `elections_organization_id_foreign` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `election_positions`
--
ALTER TABLE `election_positions`
  ADD CONSTRAINT `election_positions_election_id_foreign` FOREIGN KEY (`election_id`) REFERENCES `elections` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `events`
--
ALTER TABLE `events`
  ADD CONSTRAINT `events_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users` (`school_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `events_organization_id_foreign` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `financial_forecasts`
--
ALTER TABLE `financial_forecasts`
  ADD CONSTRAINT `financial_forecasts_organization_id_foreign` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `merchandise`
--
ALTER TABLE `merchandise`
  ADD CONSTRAINT `merchandise_organization_id_foreign` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `notifications`
--
ALTER TABLE `notifications`
  ADD CONSTRAINT `notifications_organization_id_foreign` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `notifications_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`school_id`) ON DELETE CASCADE;

--
-- Constraints for table `orders`
--
ALTER TABLE `orders`
  ADD CONSTRAINT `orders_approved_by_foreign` FOREIGN KEY (`approved_by`) REFERENCES `users` (`school_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `orders_merchandise_id_foreign` FOREIGN KEY (`merchandise_id`) REFERENCES `merchandise` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `orders_organization_id_foreign` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `orders_processed_by_foreign` FOREIGN KEY (`processed_by`) REFERENCES `users` (`school_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `orders_student_id_foreign` FOREIGN KEY (`student_id`) REFERENCES `users` (`school_id`) ON DELETE CASCADE;

--
-- Constraints for table `partylists`
--
ALTER TABLE `partylists`
  ADD CONSTRAINT `partylists_organization_id_foreign` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `tasks`
--
ALTER TABLE `tasks`
  ADD CONSTRAINT `tasks_assigned_to_foreign` FOREIGN KEY (`assigned_to`) REFERENCES `users` (`school_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `tasks_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users` (`school_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `tasks_event_id_foreign` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `tasks_organization_id_foreign` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `transactions`
--
ALTER TABLE `transactions`
  ADD CONSTRAINT `transactions_budget_id_foreign` FOREIGN KEY (`budget_id`) REFERENCES `budgets` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `transactions_organization_id_foreign` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `transactions_recorded_by_foreign` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`school_id`);

--
-- Constraints for table `users`
--
ALTER TABLE `users`
  ADD CONSTRAINT `users_organization_id_foreign` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`);

--
-- Constraints for table `votes`
--
ALTER TABLE `votes`
  ADD CONSTRAINT `votes_candidate_id_foreign` FOREIGN KEY (`candidate_id`) REFERENCES `candidates` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `votes_election_id_foreign` FOREIGN KEY (`election_id`) REFERENCES `elections` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `votes_position_id_foreign` FOREIGN KEY (`position_id`) REFERENCES `election_positions` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `votes_voter_id_foreign` FOREIGN KEY (`voter_id`) REFERENCES `users` (`school_id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;


-- ===== APPENDED HIUSA MINIMAL FEATURE PATCH =====

-- ============================================================
-- HIUSA MINIMAL APPEND-ONLY DATABASE PATCH
-- Target: Existing hiusa_db database (MariaDB 10.4 / MySQL-compatible)
-- Purpose: Add only the missing HIUSA requirements without rebuilding
--          or heavily restructuring the original capstone database.
--
-- Apply the original hiusa_db(2).sql first, then run this file.
-- ============================================================

USE `hiusa_db`;
START TRANSACTION;

-- ------------------------------------------------------------
-- 1. CORRECT THE FOUR SYSTEM ROLES
-- Keep organizational titles (President, Treasurer, etc.) separate
-- in position_title so they are not confused with access-control roles.
-- ------------------------------------------------------------

ALTER TABLE `users`
  MODIFY `role` ENUM(
    'student','officer','admin','adviser',
    'STUDENT','SBO_OFFICER','ADMIN','DEPARTMENT_HEAD'
  ) NOT NULL DEFAULT 'STUDENT';

UPDATE `users` SET `role` = 'STUDENT' WHERE `role` = 'student';
UPDATE `users` SET `role` = 'SBO_OFFICER' WHERE `role` = 'officer';
UPDATE `users` SET `role` = 'ADMIN' WHERE `role` = 'admin';
UPDATE `users` SET `role` = 'DEPARTMENT_HEAD' WHERE `role` = 'adviser';

ALTER TABLE `users`
  MODIFY `role` ENUM(
    'ADMIN','STUDENT','SBO_OFFICER','DEPARTMENT_HEAD'
  ) NOT NULL DEFAULT 'STUDENT',
  ADD COLUMN `position_title` VARCHAR(100) NULL AFTER `role`,
  ADD COLUMN `notification_preferences` LONGTEXT NULL AFTER `biometric_template`;

-- notification_preferences may store JSON such as:
-- {"events":true,"announcements":true,"merchandise":true,"elections":true}

-- Align announcement audiences with the four correct roles.
ALTER TABLE `announcements`
  MODIFY `target_role` ENUM(
    'all','student','officer','adviser',
    'STUDENT','SBO_OFFICER','ADMIN','DEPARTMENT_HEAD'
  ) NOT NULL DEFAULT 'all';

UPDATE `announcements` SET `target_role` = 'STUDENT' WHERE `target_role` = 'student';
UPDATE `announcements` SET `target_role` = 'SBO_OFFICER' WHERE `target_role` = 'officer';
UPDATE `announcements` SET `target_role` = 'DEPARTMENT_HEAD' WHERE `target_role` = 'adviser';

ALTER TABLE `announcements`
  MODIFY `target_role` ENUM(
    'all','STUDENT','SBO_OFFICER','ADMIN','DEPARTMENT_HEAD'
  ) NOT NULL DEFAULT 'all',
  ADD COLUMN `approval_status` ENUM('draft','pending','approved','rejected')
    NOT NULL DEFAULT 'draft' AFTER `category`,
  ADD COLUMN `reviewed_by` INT(10) UNSIGNED NULL AFTER `approval_status`,
  ADD COLUMN `review_remarks` TEXT NULL AFTER `reviewed_by`,
  ADD COLUMN `published_at` DATETIME NULL AFTER `is_published`,
  ADD KEY `announcements_reviewed_by_index` (`reviewed_by`),
  ADD CONSTRAINT `announcements_reviewed_by_foreign`
    FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`school_id`)
    ON DELETE SET NULL;

-- Existing published announcements are treated as approved.
UPDATE `announcements`
SET `approval_status` = CASE
  WHEN `is_published` = 1 THEN 'approved'
  ELSE 'draft'
END;

-- ------------------------------------------------------------
-- 2. SMALL ADDITIONS TO EXISTING MODULE TABLES
-- ------------------------------------------------------------

-- Event logistics/checklists/vendors can share one JSON/text field.
ALTER TABLE `events`
  ADD COLUMN `requires_budget` TINYINT(1) NOT NULL DEFAULT 0 AFTER `status`,
  ADD COLUMN `planning_details` LONGTEXT NULL AFTER `requires_budget`,
  ADD COLUMN `approved_at` DATETIME NULL AFTER `planning_details`;

-- planning_details can contain vendor deadlines, resources, logistics,
-- and checklist items generated manually or through the Groq assistant.

-- Budget approval and advisory results stay inside the existing budget table.
ALTER TABLE `budgets`
  ADD COLUMN `remaining_amount` DECIMAL(10,2) NULL AFTER `allocated_amount`,
  ADD COLUMN `advisory_note` TEXT NULL AFTER `warning_threshold`,
  ADD COLUMN `overspending_risk` ENUM('low','medium','high') NULL AFTER `advisory_note`;

-- Digital receipts and event-level receipt numbering stay in transactions.
ALTER TABLE `transactions`
  ADD COLUMN `event_id` BIGINT(20) UNSIGNED NULL AFTER `budget_id`,
  ADD COLUMN `payer_id` INT(10) UNSIGNED NULL AFTER `recorded_by`,
  ADD COLUMN `receipt_number` INT UNSIGNED NULL AFTER `receipt_reference`,
  ADD COLUMN `receipt_file_url` VARCHAR(500) NULL AFTER `receipt_number`,
  ADD KEY `transactions_event_id_index` (`event_id`),
  ADD KEY `transactions_payer_id_index` (`payer_id`),
  ADD UNIQUE KEY `transactions_event_receipt_unique` (`event_id`,`receipt_number`),
  ADD CONSTRAINT `transactions_event_id_foreign`
    FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `transactions_payer_id_foreign`
    FOREIGN KEY (`payer_id`) REFERENCES `users` (`school_id`) ON DELETE SET NULL;

-- receipt_number may restart at 1 for each event because uniqueness is
-- enforced by the pair (event_id, receipt_number), not globally.

-- Extend forecasting records for OLS outputs and safe spending guidance.
ALTER TABLE `financial_forecasts`
  ADD COLUMN `predicted_balance` DECIMAL(10,2) NULL AFTER `predicted_expense`,
  ADD COLUMN `safe_spending_limit` DECIMAL(10,2) NULL AFTER `predicted_balance`,
  ADD COLUMN `model_details` LONGTEXT NULL AFTER `confidence_note`,
  ADD COLUMN `generated_by` INT(10) UNSIGNED NULL AFTER `model_details`,
  ADD KEY `financial_forecasts_generated_by_index` (`generated_by`),
  ADD CONSTRAINT `financial_forecasts_generated_by_foreign`
    FOREIGN KEY (`generated_by`) REFERENCES `users` (`school_id`)
    ON DELETE SET NULL;

-- Add online payment proof, dual review, and claim validation to orders.
ALTER TABLE `orders`
  ADD COLUMN `payment_method` ENUM('cash','gcash','other') NULL AFTER `total_price`,
  ADD COLUMN `payment_reference` VARCHAR(150) NULL AFTER `payment_method`,
  ADD COLUMN `payment_proof_url` VARCHAR(500) NULL AFTER `payment_reference`,
  ADD COLUMN `officer_review_status` ENUM('pending','approved','rejected')
    NOT NULL DEFAULT 'pending' AFTER `payment_proof_url`,
  ADD COLUMN `admin_review_status` ENUM('pending','approved','rejected')
    NOT NULL DEFAULT 'pending' AFTER `officer_review_status`,
  ADD COLUMN `review_remarks` TEXT NULL AFTER `admin_review_status`,
  ADD COLUMN `claim_verified_by` INT(10) UNSIGNED NULL AFTER `approved_by`,
  ADD COLUMN `claim_verified_at` DATETIME NULL AFTER `claim_verified_by`,
  ADD COLUMN `transaction_id` BIGINT(20) UNSIGNED NULL AFTER `claim_verified_at`,
  ADD KEY `orders_claim_verified_by_index` (`claim_verified_by`),
  ADD KEY `orders_transaction_id_index` (`transaction_id`),
  ADD CONSTRAINT `orders_claim_verified_by_foreign`
    FOREIGN KEY (`claim_verified_by`) REFERENCES `users` (`school_id`)
    ON DELETE SET NULL,
  ADD CONSTRAINT `orders_transaction_id_foreign`
    FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`id`)
    ON DELETE SET NULL;

-- Preserve the existing tasks table and add only delegation/workflow fields.
ALTER TABLE `tasks`
  ADD COLUMN `task_type` ENUM('regular','workflow')
    NOT NULL DEFAULT 'regular' AFTER `event_id`,
  ADD COLUMN `is_ai_generated` TINYINT(1) NOT NULL DEFAULT 0 AFTER `task_type`,
  ADD COLUMN `role_score` DECIMAL(6,2) NULL AFTER `ai_recommendation_note`,
  ADD COLUMN `workload_score` DECIMAL(6,2) NULL AFTER `role_score`,
  ADD COLUMN `performance_score` DECIMAL(6,2) NULL AFTER `workload_score`,
  ADD COLUMN `final_score` DECIMAL(8,2) NULL AFTER `performance_score`,
  ADD COLUMN `progress_percent` TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER `final_score`,
  ADD COLUMN `completed_at` DATETIME NULL AFTER `progress_percent`;

-- Election creation still uses the existing elections table.
ALTER TABLE `elections`
  ADD COLUMN `results_visible` TINYINT(1) NOT NULL DEFAULT 1 AFTER `status`,
  ADD COLUMN `approved_at` DATETIME NULL AFTER `results_visible`;

-- Scheduled event reminders share the existing notifications table.
ALTER TABLE `notifications`
  ADD COLUMN `notification_type` ENUM(
    'general','event','announcement','task','election','merchandise','financial'
  ) NOT NULL DEFAULT 'general' AFTER `user_id`,
  ADD COLUMN `reference_type` VARCHAR(40) NULL AFTER `message`,
  ADD COLUMN `reference_id` BIGINT UNSIGNED NULL AFTER `reference_type`,
  ADD COLUMN `scheduled_at` DATETIME NULL AFTER `reference_id`,
  ADD COLUMN `sent_at` DATETIME NULL AFTER `scheduled_at`;

-- More complete attendance records while keeping one attendance table.
ALTER TABLE `attendance`
  ADD COLUMN `check_out_time` DATETIME NULL AFTER `check_in_time`,
  ADD COLUMN `recorded_by` INT(10) UNSIGNED NULL AFTER `method`,
  ADD COLUMN `remarks` VARCHAR(255) NULL AFTER `recorded_by`,
  ADD KEY `attendance_recorded_by_index` (`recorded_by`),
  ADD CONSTRAINT `attendance_recorded_by_foreign`
    FOREIGN KEY (`recorded_by`) REFERENCES `users` (`school_id`)
    ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 3. FOUR SHARED TABLES FOR THE REMAINING CROSS-MODULE FEATURES
-- ------------------------------------------------------------

-- Generic approval table shared by events, budgets, elections, announcements,
-- and any future entity that requires Admin or Department Head review.
CREATE TABLE `approval_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NULL,
  `entity_type` ENUM('event','budget','election','announcement','payment') NOT NULL,
  `entity_id` BIGINT UNSIGNED NOT NULL,
  `requested_by` INT UNSIGNED NOT NULL,
  `required_role` ENUM('ADMIN','DEPARTMENT_HEAD') NOT NULL,
  `status` ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `reviewed_by` INT UNSIGNED NULL,
  `remarks` TEXT NULL,
  `requested_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reviewed_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `approval_entity_index` (`entity_type`,`entity_id`),
  KEY `approval_status_role_index` (`status`,`required_role`),
  CONSTRAINT `approval_requests_organization_fk`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
    ON DELETE SET NULL,
  CONSTRAINT `approval_requests_requested_by_fk`
    FOREIGN KEY (`requested_by`) REFERENCES `users` (`school_id`)
    ON DELETE CASCADE,
  CONSTRAINT `approval_requests_reviewed_by_fk`
    FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`school_id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Shared Groq LLM output table for event planning, financial summarization,
-- budget advice, and workflow generation.
CREATE TABLE `ai_outputs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NULL,
  `feature_type` ENUM(
    'financial_summary','budget_advisory','event_planning','workflow_generation'
  ) NOT NULL,
  `reference_type` VARCHAR(40) NULL,
  `reference_id` BIGINT UNSIGNED NULL,
  `prompt_text` LONGTEXT NULL,
  `output_text` LONGTEXT NOT NULL,
  `model_name` VARCHAR(100) NULL,
  `requested_by` INT UNSIGNED NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ai_outputs_reference_index` (`reference_type`,`reference_id`),
  CONSTRAINT `ai_outputs_organization_fk`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
    ON DELETE SET NULL,
  CONSTRAINT `ai_outputs_requested_by_fk`
    FOREIGN KEY (`requested_by`) REFERENCES `users` (`school_id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Stores generated income statements, expense summaries, audit reports,
-- and event-specific reports, including PDF/Excel export locations.
CREATE TABLE `financial_reports` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NULL,
  `event_id` BIGINT UNSIGNED NULL,
  `report_type` ENUM(
    'income_statement','expense_summary','audit_log','event_financial','custom'
  ) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `period_start` DATE NULL,
  `period_end` DATE NULL,
  `summary_text` LONGTEXT NULL,
  `source_transaction_ids` LONGTEXT NULL,
  `pdf_url` VARCHAR(500) NULL,
  `excel_url` VARCHAR(500) NULL,
  `ai_output_id` BIGINT UNSIGNED NULL,
  `generated_by` INT UNSIGNED NULL,
  `generated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `financial_reports_event_index` (`event_id`),
  CONSTRAINT `financial_reports_organization_fk`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
    ON DELETE SET NULL,
  CONSTRAINT `financial_reports_event_fk`
    FOREIGN KEY (`event_id`) REFERENCES `events` (`id`)
    ON DELETE SET NULL,
  CONSTRAINT `financial_reports_ai_output_fk`
    FOREIGN KEY (`ai_output_id`) REFERENCES `ai_outputs` (`id`)
    ON DELETE SET NULL,
  CONSTRAINT `financial_reports_generated_by_fk`
    FOREIGN KEY (`generated_by`) REFERENCES `users` (`school_id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One audit table shared by all modules for transparency and accountability.
CREATE TABLE `audit_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NULL,
  `user_id` INT UNSIGNED NULL,
  `module` VARCHAR(50) NOT NULL,
  `action` VARCHAR(100) NOT NULL,
  `record_type` VARCHAR(50) NULL,
  `record_id` BIGINT UNSIGNED NULL,
  `old_values` LONGTEXT NULL,
  `new_values` LONGTEXT NULL,
  `ip_address` VARCHAR(45) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `audit_record_index` (`record_type`,`record_id`),
  KEY `audit_module_action_index` (`module`,`action`),
  CONSTRAINT `audit_logs_organization_fk`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
    ON DELETE SET NULL,
  CONSTRAINT `audit_logs_user_fk`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`school_id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;

-- ============================================================
-- RESULT
-- Existing application tables retained: 26
-- New shared feature tables added: 4
-- Total after patch: 30 tables
--
-- No separate tables were added for:
-- - Event vendors/resources/checklists (events.planning_details)
-- - Budget advisories (budgets.advisory_note)
-- - Digital receipts (transactions receipt fields)
-- - Task workflows/recommendation scores (tasks fields)
-- - Payment reviews/claim validation (orders fields)
-- - Reminder scheduling (notifications fields)
-- ============================================================
