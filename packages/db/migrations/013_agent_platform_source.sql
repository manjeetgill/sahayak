-- Source of a platform-authored draft. Sahayak stores and executes its own validated snapshot.
ALTER TABLE custom_agents
  ADD COLUMN platform_draft_id uuid,
  ADD COLUMN platform_version int;
