-- Indexes for every filter, search and sort the app runs (see server/repos/*.ts).

-- Trigram matching lets "contains" searches (LIKE '%text%') use an index
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Order tracker & staff lookup: upper(order_number) = upper($1)
CREATE INDEX orders_order_number_upper_idx ON orders (upper(order_number));

-- Staff order filters, each newest first
CREATE INDEX orders_payment_status_idx ON orders (payment_status, created_at DESC);
CREATE INDEX orders_pickup_date_idx    ON orders (pickup_date, created_at DESC);
CREATE INDEX orders_floor_idx          ON orders (floor_number, created_at DESC);
CREATE INDEX orders_dine_in_idx        ON orders (created_at DESC) WHERE service_type = 'dine_in';

-- New-order alert, checked every 5 seconds by the staff portal
CREATE INDEX orders_unhandled_idx ON orders (created_at)
  WHERE status = 'pending' AND payment_status = 'successful' AND NOT sound_alert_dismissed;

-- Staff search box: one expression across number, names, email and phone
CREATE INDEX orders_search_trgm_idx ON orders USING gin (
  lower(order_number || ' ' || customer_first_name || ' ' || customer_last_name || ' ' || customer_email || ' ' || customer_phone)
  gin_trgm_ops
);

-- Menu listing order, and each dish's extras in order
CREATE INDEX menu_items_sort_idx            ON menu_items (sort_order, created_at);
CREATE INDEX menu_item_extras_position_idx  ON menu_item_extras (menu_item_id, position);

-- Owner lookups and the staff list
CREATE INDEX staff_users_role_idx ON staff_users (role, created_at);

-- An order's history, newest first (replaces the single-column index)
DROP INDEX IF EXISTS audit_logs_order_idx;
CREATE INDEX audit_logs_order_created_idx ON audit_logs (related_order_id, created_at DESC);
CREATE INDEX notification_logs_order_idx  ON notification_logs (order_id, created_at DESC);
