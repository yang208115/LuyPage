ALTER TABLE workspace_state ADD COLUMN homepage_layout TEXT NOT NULL DEFAULT '{"version":1,"desktop":null,"mobile":null}' CHECK(json_valid(homepage_layout));
