CREATE TABLE users (
  id BIGINT PRIMARY KEY,             -- telegram user id
  username VARCHAR(64),
  balance BIGINT NOT NULL DEFAULT 0, -- saldo (rupiah)
  is_banned TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) UNIQUE,
  name VARCHAR(255),
  description TEXT,
  price BIGINT NOT NULL,
  note TEXT,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE product_stock (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  content TEXT NOT NULL,             -- misal akun:email|password
  is_taken TINYINT(1) DEFAULT 0,
  taken_by BIGINT NULL,
  taken_at DATETIME NULL,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE deposits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  amount BIGINT NOT NULL,
  status ENUM('PENDING','PAID','EXPIRED','FAILED') DEFAULT 'PENDING',
  reference_id VARCHAR(64) UNIQUE,
  ipaymu_trx_id VARCHAR(64),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  product_id INT NOT NULL,
  qty INT NOT NULL DEFAULT 1,
  amount BIGINT NOT NULL,
  status ENUM('PENDING','PAID','CANCELLED','FAILED') DEFAULT 'PENDING',
  buynow TINYINT(1) DEFAULT 0,       -- 1 = langsung via QRIS
  reference_id VARCHAR(64) UNIQUE,
  ipaymu_trx_id VARCHAR(64),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);
