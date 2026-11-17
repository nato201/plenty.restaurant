-- Plenty restaurant: initial schema.
-- Money is stored as NUMERIC(12,2) in Ethiopian birr. Timestamps are timestamptz (UTC).
-- Text ids are kept (e.g. 'ord-…', 'pay-…') so existing records and URLs stay valid.

-- ---------------------------------------------------------------------------
-- Menu
-- ---------------------------------------------------------------------------
CREATE TABLE menu_items (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  category      TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 40),
  group_label   TEXT,
  description   TEXT NOT NULL,
  price         NUMERIC(12,2) NOT NULL CHECK (price > 0),
  available     BOOLEAN NOT NULL DEFAULT TRUE,
  image_url     TEXT,
  is_vegetarian BOOLEAN NOT NULL DEFAULT FALSE,
  is_fasting    BOOLEAN NOT NULL DEFAULT FALSE,
  is_special    BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX menu_items_category_idx ON menu_items (category, sort_order);

-- Extras a customer can add to a dish (e.g. "Fried egg +35")
CREATE TABLE menu_item_extras (
  menu_item_id  TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  extra_id      TEXT NOT NULL,
  name          TEXT NOT NULL,
  price         NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (menu_item_id, extra_id)
);

-- ---------------------------------------------------------------------------
-- Restaurant settings (single row; flexible JSON for hours, capacity, etc.)
-- ---------------------------------------------------------------------------
CREATE TABLE restaurant_settings (
  id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Staff accounts (password_hash is never sent to clients)
-- ---------------------------------------------------------------------------
CREATE TABLE staff_users (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('super_admin', 'restaurant_admin', 'reporting')),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  password_hash  TEXT,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX staff_users_email_key ON staff_users (lower(email));

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
CREATE SEQUENCE order_number_seq START 101;

CREATE TABLE orders (
  id                     TEXT PRIMARY KEY,
  order_number           TEXT NOT NULL UNIQUE,
  customer_first_name    TEXT NOT NULL,
  customer_last_name     TEXT NOT NULL,
  customer_email         TEXT NOT NULL,
  customer_phone         TEXT NOT NULL,
  pickup_date            DATE NOT NULL,
  pickup_time            TEXT NOT NULL,          -- slot label, e.g. "12:15 PM"
  floor_number           SMALLINT NOT NULL CHECK (floor_number IN (2, 8, 10, 11, 12, 13)),
  special_instructions   TEXT,
  subtotal               NUMERIC(12,2) NOT NULL,
  tax_or_fees            NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount           NUMERIC(12,2) NOT NULL,
  status                 TEXT NOT NULL CHECK (status IN ('pending','accepted','preparing','ready','completed','declined','cancelled')),
  payment_status         TEXT NOT NULL CHECK (payment_status IN ('pending','successful','failed','refunded','partially_refunded')),
  payment_id             TEXT,
  estimated_prep_minutes INTEGER,
  estimated_ready_time   TEXT,
  accepted_at            TIMESTAMPTZ,
  declined_reason        TEXT,
  declined_at            TIMESTAMPTZ,
  cancellation_reason    TEXT,
  cancelled_at           TIMESTAMPTZ,
  completed_at           TIMESTAMPTZ,
  sound_alert_dismissed  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX orders_slot_idx ON orders (pickup_date, pickup_time) WHERE status NOT IN ('declined', 'cancelled');
CREATE INDEX orders_status_idx ON orders (status, created_at DESC);
CREATE INDEX orders_customer_email_idx ON orders (lower(customer_email));
CREATE INDEX orders_created_idx ON orders (created_at DESC);

CREATE TABLE order_items (
  id                BIGSERIAL PRIMARY KEY,
  order_id          TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL,
  menu_item_id      TEXT NOT NULL,              -- no FK: dishes can be deleted, orders keep their copy
  name              TEXT NOT NULL,
  unit_price        NUMERIC(12,2) NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  selected_extras   JSONB NOT NULL DEFAULT '[]',
  special_notes     TEXT,
  total_price       NUMERIC(12,2) NOT NULL
);
CREATE INDEX order_items_order_idx ON order_items (order_id, position);

-- ---------------------------------------------------------------------------
-- Payments (Chapa)
-- ---------------------------------------------------------------------------
CREATE TABLE payments (
  id                TEXT PRIMARY KEY,
  order_id          TEXT REFERENCES orders(id) ON DELETE SET NULL,
  order_number      TEXT,
  provider          TEXT NOT NULL DEFAULT 'Chapa',
  tx_ref            TEXT NOT NULL UNIQUE,
  chapa_reference   TEXT,
  amount            NUMERIC(12,2) NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'ETB',
  payment_method    TEXT NOT NULL DEFAULT 'other',
  status            TEXT NOT NULL CHECK (status IN ('pending','successful','failed','refunded','partially_refunded')),
  customer_email    TEXT NOT NULL,
  customer_name     TEXT NOT NULL,
  customer_phone    TEXT,
  checkout_url      TEXT,
  paid_at           TIMESTAMPTZ,
  refund_reference  TEXT,
  refund_reason     TEXT,
  refund_amount     NUMERIC(12,2),
  refunded_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payments_order_idx ON payments (order_id);
CREATE INDEX payments_created_idx ON payments (created_at DESC);

-- Checkout details waiting for payment to complete. Becomes an order once Chapa confirms.
CREATE TABLE pending_checkouts (
  tx_ref        TEXT PRIMARY KEY REFERENCES payments(tx_ref) ON DELETE CASCADE,
  customer      JSONB NOT NULL,
  pickup        JSONB NOT NULL,
  items         JSONB NOT NULL,
  subtotal      NUMERIC(12,2) NOT NULL,
  tax_or_fees   NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount  NUMERIC(12,2) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Logs
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id                TEXT PRIMARY KEY,
  admin_id          TEXT NOT NULL,
  admin_name        TEXT NOT NULL,
  action            TEXT NOT NULL,
  related_order_id  TEXT,
  previous_value    TEXT,
  new_value         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_order_idx ON audit_logs (related_order_id);

CREATE TABLE notification_logs (
  id            TEXT PRIMARY KEY,
  order_id      TEXT,
  order_number  TEXT,
  channel       TEXT NOT NULL CHECK (channel IN ('sound', 'email', 'teams')),
  title         TEXT NOT NULL,
  message       TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('sent', 'pending', 'failed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notification_logs_created_idx ON notification_logs (created_at DESC);
