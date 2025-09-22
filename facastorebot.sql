-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Sep 16, 2025 at 04:47 PM
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
-- Database: `facastorebot`
--

-- --------------------------------------------------------

--
-- Table structure for table `deposits`
--

CREATE TABLE `deposits` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `amount` bigint(20) UNSIGNED NOT NULL,
  `reference_id` varchar(64) NOT NULL,
  `ipaymu_trx_id` varchar(64) DEFAULT NULL,
  `status` enum('PENDING','PAID','CANCELLED','FAILED') NOT NULL DEFAULT 'PENDING',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `paid_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `orders`
--

CREATE TABLE `orders` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `product_id` bigint(20) UNSIGNED NOT NULL,
  `qty` int(10) UNSIGNED NOT NULL,
  `amount` bigint(20) UNSIGNED NOT NULL,
  `status` enum('PENDING','PAID','CANCELLED','FAILED') NOT NULL DEFAULT 'PENDING',
  `buynow` tinyint(1) NOT NULL DEFAULT 0,
  `reference_id` varchar(64) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `paid_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `products`
--

CREATE TABLE `products` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `code` varchar(64) NOT NULL,
  `name` varchar(255) NOT NULL,
  `price` bigint(20) UNSIGNED NOT NULL,
  `description` text NOT NULL,
  `note` text DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `products`
--

INSERT INTO `products` (`id`, `code`, `name`, `price`, `description`, `note`, `is_active`, `created_at`) VALUES
(1, 'NETFLIX1B', 'NETFLIX 1 BULAN', 1000, 'GARANSI', NULL, 1, '2025-09-14 10:12:41'),
(2, 'NETFLIX2B', 'NETFLIX 2 BULAN', 1000, 'GARANSI', NULL, 1, '2025-09-14 10:12:47'),
(3, 'NETFLIX3B', 'NETFLIX 3 BULAN', 1000, 'GARANSI', NULL, 1, '2025-09-14 10:12:52'),
(4, 'YT1B', 'YOUTUBE 1 BULAN', 1000, 'GARANSI', NULL, 1, '2025-09-14 10:13:11'),
(5, 'YT2B', 'YOUTUBE 2 BULAN', 1000, 'GARANSI', NULL, 1, '2025-09-14 10:13:16'),
(6, 'YT3B', 'YOUTUBE 3 BULAN', 1000, 'GARANSI', NULL, 1, '2025-09-14 10:13:20'),
(7, 'SPO1B', 'SPOTIFY 1 BULAN', 1000, 'GARANSI', NULL, 1, '2025-09-14 10:13:33'),
(8, 'SPO2B', 'SPOTIFY 2 BULAN', 1000, 'GARANSI', NULL, 1, '2025-09-14 10:13:37'),
(9, 'SPO3B', 'SPOTIFY 3 BULAN', 1000, 'GARANSI', NULL, 1, '2025-09-14 10:13:42'),
(10, 'CHATGPT1B', 'CHAT GPT 1 BULAN', 1000, 'GARANSI', NULL, 1, '2025-09-14 10:14:00'),
(12, 'CHATGPT2B', 'CHATGPT 2 BULAN', 20000, 'GARANSI', NULL, 1, '2025-09-14 10:21:05');

-- --------------------------------------------------------

--
-- Table structure for table `product_stock`
--

CREATE TABLE `product_stock` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `product_id` bigint(20) UNSIGNED NOT NULL,
  `content` text NOT NULL,
  `is_taken` tinyint(1) NOT NULL DEFAULT 0,
  `taken_by` bigint(20) UNSIGNED DEFAULT NULL,
  `taken_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `ps_email` varchar(255) GENERATED ALWAYS AS (json_unquote(json_extract(`content`,'$.email'))) STORED,
  `ps_password` varchar(255) GENERATED ALWAYS AS (json_unquote(json_extract(`content`,'$.password'))) VIRTUAL,
  `ps_pin` varchar(64) GENERATED ALWAYS AS (json_unquote(json_extract(`content`,'$.pin'))) VIRTUAL,
  `ps_profil` varchar(255) GENERATED ALWAYS AS (json_unquote(json_extract(`content`,'$.profil'))) VIRTUAL,
  `ps_ver` int(11) GENERATED ALWAYS AS (json_extract(`content`,'$.v')) VIRTUAL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `product_stock`
--

INSERT INTO `product_stock` (`id`, `product_id`, `content`, `is_taken`, `taken_by`, `taken_at`, `created_at`) VALUES
(1, 1, '{\"email\":\"email1@mail.com\",\"password\":\"pass1\",\"pin\":\"1234\",\"profil\":\"profil1\",\"v\":2}', 0, NULL, NULL, '2025-09-16 14:31:04'),
(2, 1, '{\"email\":\"email1@mail.com\",\"password\":\"pass1\",\"pin\":\"1234\",\"profil\":\"profil2\",\"v\":2}', 0, NULL, NULL, '2025-09-16 14:31:04'),
(3, 1, '{\"email\":\"email1@mail.com\",\"password\":\"pass1\",\"pin\":\"1235\",\"profil\":\"profil3\",\"v\":2}', 0, NULL, NULL, '2025-09-16 14:31:04');

--
-- Triggers `product_stock`
--
DELIMITER $$
CREATE TRIGGER `trg_product_stock_validate` BEFORE INSERT ON `product_stock` FOR EACH ROW BEGIN
  IF JSON_VALID(NEW.content) = 1 THEN
    IF COALESCE(JSON_UNQUOTE(JSON_EXTRACT(NEW.content, '$.email')), '') = '' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product_stock.content JSON must include non-empty "email"';
    END IF;
  END IF;
END
$$
DELIMITER ;
DELIMITER $$
CREATE TRIGGER `trg_product_stock_validate_upd` BEFORE UPDATE ON `product_stock` FOR EACH ROW BEGIN
  IF JSON_VALID(NEW.content) = 1 THEN
    IF COALESCE(JSON_UNQUOTE(JSON_EXTRACT(NEW.content, '$.email')), '') = '' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product_stock.content JSON must include non-empty "email"';
    END IF;
  END IF;
END
$$
DELIMITER ;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `username` varchar(64) DEFAULT NULL,
  `balance` bigint(20) UNSIGNED NOT NULL DEFAULT 0,
  `is_banned` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `username`, `balance`, `is_banned`, `created_at`) VALUES
(6509765731, 'gladd2', 0, 0, '2025-09-14 10:11:09'),
(7156192504, 'noxxyyyyy', 0, 0, '2025-09-16 13:28:01');

--
-- Triggers `users`
--
DELIMITER $$
CREATE TRIGGER `trg_users_balance_nonneg` BEFORE UPDATE ON `users` FOR EACH ROW BEGIN
  IF NEW.balance < 0 THEN
    SET NEW.balance = 0;
  END IF;
END
$$
DELIMITER ;

-- --------------------------------------------------------

--
-- Stand-in structure for view `v_product_summary`
-- (See below for the actual view)
--
CREATE TABLE `v_product_summary` (
`id` bigint(20) unsigned
,`code` varchar(64)
,`name` varchar(255)
,`price` bigint(20) unsigned
,`sisa` decimal(22,0)
,`terjual` decimal(22,0)
);

-- --------------------------------------------------------

--
-- Stand-in structure for view `v_stock_pretty`
-- (See below for the actual view)
--
CREATE TABLE `v_stock_pretty` (
`id` bigint(20) unsigned
,`product_id` bigint(20) unsigned
,`product_code` varchar(64)
,`product_name` varchar(255)
,`is_taken` tinyint(1)
,`taken_by` bigint(20) unsigned
,`taken_at` timestamp
,`created_at` timestamp
,`email` varchar(255)
,`password` varchar(255)
,`pin` varchar(64)
,`profil` varchar(255)
,`json_version` int(11)
);

-- --------------------------------------------------------

--
-- Structure for view `v_product_summary`
--
DROP TABLE IF EXISTS `v_product_summary`;

CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `v_product_summary`  AS SELECT `p`.`id` AS `id`, `p`.`code` AS `code`, `p`.`name` AS `name`, `p`.`price` AS `price`, sum(case when `s`.`is_taken` = 0 then 1 else 0 end) AS `sisa`, sum(case when `s`.`is_taken` = 1 then 1 else 0 end) AS `terjual` FROM (`products` `p` left join `product_stock` `s` on(`s`.`product_id` = `p`.`id`)) GROUP BY `p`.`id`, `p`.`code`, `p`.`name`, `p`.`price` ;

-- --------------------------------------------------------

--
-- Structure for view `v_stock_pretty`
--
DROP TABLE IF EXISTS `v_stock_pretty`;

CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `v_stock_pretty`  AS SELECT `s`.`id` AS `id`, `s`.`product_id` AS `product_id`, `p`.`code` AS `product_code`, `p`.`name` AS `product_name`, `s`.`is_taken` AS `is_taken`, `s`.`taken_by` AS `taken_by`, `s`.`taken_at` AS `taken_at`, `s`.`created_at` AS `created_at`, `s`.`ps_email` AS `email`, `s`.`ps_password` AS `password`, `s`.`ps_pin` AS `pin`, `s`.`ps_profil` AS `profil`, `s`.`ps_ver` AS `json_version` FROM (`product_stock` `s` left join `products` `p` on(`p`.`id` = `s`.`product_id`)) ;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `deposits`
--
ALTER TABLE `deposits`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `reference_id` (`reference_id`),
  ADD KEY `idx_deposits_user` (`user_id`,`created_at`),
  ADD KEY `idx_deposits_status` (`status`);

--
-- Indexes for table `orders`
--
ALTER TABLE `orders`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `reference_id` (`reference_id`),
  ADD KEY `fk_orders_product` (`product_id`),
  ADD KEY `idx_orders_user` (`user_id`,`created_at`),
  ADD KEY `idx_orders_status` (`status`);

--
-- Indexes for table `products`
--
ALTER TABLE `products`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `code` (`code`),
  ADD KEY `idx_products_active` (`is_active`),
  ADD KEY `idx_products_price` (`price`);

--
-- Indexes for table `product_stock`
--
ALTER TABLE `product_stock`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_stock_product` (`product_id`,`is_taken`),
  ADD KEY `idx_stock_takenby` (`taken_by`),
  ADD KEY `idx_stock_email` (`ps_email`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_users_username` (`username`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `deposits`
--
ALTER TABLE `deposits`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `orders`
--
ALTER TABLE `orders`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `products`
--
ALTER TABLE `products`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=13;

--
-- AUTO_INCREMENT for table `product_stock`
--
ALTER TABLE `product_stock`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `deposits`
--
ALTER TABLE `deposits`
  ADD CONSTRAINT `fk_deposits_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE;

--
-- Constraints for table `orders`
--
ALTER TABLE `orders`
  ADD CONSTRAINT `fk_orders_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_orders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE;

--
-- Constraints for table `product_stock`
--
ALTER TABLE `product_stock`
  ADD CONSTRAINT `fk_stock_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
