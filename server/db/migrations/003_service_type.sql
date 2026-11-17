-- How the customer gets their food: delivered to their floor, or eaten at a table in the restaurant.
-- Existing orders were all floor orders, so they become 'delivery'. Dine-in orders have no floor.
ALTER TABLE orders
  ADD COLUMN service_type TEXT NOT NULL DEFAULT 'delivery'
    CHECK (service_type IN ('delivery', 'dine_in'));

ALTER TABLE orders ALTER COLUMN floor_number DROP NOT NULL;

ALTER TABLE orders
  ADD CONSTRAINT orders_delivery_needs_floor
    CHECK (service_type = 'dine_in' OR floor_number IS NOT NULL);
