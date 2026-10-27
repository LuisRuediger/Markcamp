-- Bait sites and their history as an append-only event log (ADR 0005).
-- Same rules as V1: UUID v7 primary keys with no database default (ADR 0002),
-- text + CHECK instead of ENUM, every constraint named explicitly, no updated_at.
-- No ON DELETE CASCADE from projects to sites or from sites to events: history is the
-- product, and deleting it must be an explicit feature, not a side effect.
-- Event immutability (ADR 0005, rule 1) is enforced in the application, not with triggers.

-- Global reference list, not per project (ADR 0005, Species).
-- Identity is the scientific name; common_name is display data for the UI.
CREATE TABLE species (
    id              uuid        NOT NULL,
    scientific_name text        NOT NULL,
    common_name     text        NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT species_pkey PRIMARY KEY (id),
    CONSTRAINT species_scientific_name_key UNIQUE (scientific_name),
    CONSTRAINT species_scientific_name_check CHECK (char_length(btrim(scientific_name)) BETWEEN 1 AND 100),
    CONSTRAINT species_common_name_check CHECK (char_length(btrim(common_name)) BETWEEN 1 AND 100)
);

-- Fixed UUID v7 literals so every environment has the same ids (ADR 0005, rule 6).
-- Common names are data shown in the UI, not code, so Portuguese is allowed here.
INSERT INTO species (id, scientific_name, common_name) VALUES
    ('01a17fce-7800-77ac-81e1-875a2a5b870c', 'Tetragonisca angustula',      'Jataí'),
    ('01a17fce-7801-7451-8827-2ebec51476ea', 'Tetragona clavipes',          'Borá'),
    ('01a17fce-7802-7608-8897-9e6918cfe44b', 'Nannotrigona testaceicornis', 'Iraí'),
    ('01a17fce-7803-77bc-9b4c-e6de3efd3000', 'Friesella schrottkyi',        'Mirim-preguiça'),
    ('01a17fce-7804-722e-bb1e-6dcbee581cbc', 'Plebeia droryana',            'Mirim-droriana'),
    ('01a17fce-7805-7722-9c11-7412cd4c5ec8', 'Plebeia emerina',             'Mirim-emerina'),
    ('01a17fce-7806-7de9-bb1a-9548c451e411', 'Plebeia remota',              'Mirim-guaçu'),
    ('01a17fce-7807-743e-b77a-504ee07dc809', 'Plebeia sp.',                 'Mirim (espécie não definida)'),
    ('01a17fce-7808-7d18-bec7-7b61cc0fee9b', 'Scaptotrigona bipunctata',    'Tubuna'),
    ('01a17fce-7809-793c-874c-479aef9d2308', 'Scaptotrigona depilis',       'Mandaguari'),
    ('01a17fce-780a-7b6e-98c4-2128d6c673b3', 'Scaptotrigona xanthotricha',  'Mandaguari-amarela'),
    ('01a17fce-780b-7168-aea0-d002b3d7bf60', 'Scaptotrigona sp.',           'Scaptotrigona (espécie não definida)'),
    ('01a17fce-780c-73a9-9f85-5c2d4e7a549f', 'Melipona quadrifasciata',     'Mandaçaia'),
    ('01a17fce-780d-7f57-b4ae-ad552f19033a', 'Melipona bicolor',            'Guaraipo'),
    ('01a17fce-780e-75cc-805d-3c25faaa8cce', 'Melipona marginata',          'Manduri'),
    ('01a17fce-780f-733d-82bf-5b3a0a4c083d', 'Melipona sp.',                'Melipona (espécie não definida)');

-- A place in the field (usually a tree) that receives baits. No status column:
-- status is derived from bait_site_events (ADR 0005).
-- Belongs to a project; access goes through project_members (ADR 0001).
CREATE TABLE bait_sites (
    id                  uuid             NOT NULL,
    project_id          uuid             NOT NULL,
    -- Not unique: pre-filled offline ("Isca 31"), two devices can produce the same name,
    -- and a sync must never fail because of a name. Identity is the UUID.
    name                text             NOT NULL,
    -- Two plain columns, no PostGIS: no spatial query needs it yet.
    latitude            double precision NOT NULL,
    longitude           double precision NOT NULL,
    -- Null when the site was placed by hand on the map.
    location_accuracy_m double precision,
    -- Attribution only, never authorization (ADR 0001, rule 1).
    created_by          uuid             NOT NULL,
    created_at          timestamptz      NOT NULL DEFAULT now(),

    CONSTRAINT bait_sites_pkey PRIMARY KEY (id),
    CONSTRAINT bait_sites_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects (id),
    CONSTRAINT bait_sites_created_by_fkey FOREIGN KEY (created_by) REFERENCES users (id),
    CONSTRAINT bait_sites_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
    CONSTRAINT bait_sites_latitude_check CHECK (latitude BETWEEN -90 AND 90),
    CONSTRAINT bait_sites_longitude_check CHECK (longitude BETWEEN -180 AND 180),
    CONSTRAINT bait_sites_location_accuracy_m_check CHECK (location_accuracy_m > 0)
);

-- Supports "list the sites of a project".
CREATE INDEX bait_sites_project_id_idx ON bait_sites (project_id);

-- Append-only history of a bait site (ADR 0005). Rows are never updated or deleted;
-- the only allowed change is voiding (voided_at + voided_by), checked in the application.
CREATE TABLE bait_site_events (
    id                  uuid        NOT NULL,
    bait_site_id        uuid        NOT NULL,
    event_type          text        NOT NULL,
    -- When it happened in the field, sent by the client (ADR 0005, rule 2).
    occurred_at         timestamptz NOT NULL,
    -- When the server stored the row.
    recorded_at         timestamptz NOT NULL DEFAULT now(),
    recorded_by         uuid        NOT NULL,
    species_id          uuid,
    -- The capture this IDENTIFIED event identifies (ADR 0005, rule 4).
    identified_event_id uuid,
    voided_at           timestamptz,
    voided_by           uuid,

    CONSTRAINT bait_site_events_pkey PRIMARY KEY (id),
    CONSTRAINT bait_site_events_bait_site_id_fkey FOREIGN KEY (bait_site_id) REFERENCES bait_sites (id),
    CONSTRAINT bait_site_events_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES users (id),
    CONSTRAINT bait_site_events_species_id_fkey FOREIGN KEY (species_id) REFERENCES species (id),
    CONSTRAINT bait_site_events_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES users (id),
    -- Redundant as uniqueness (id is already the primary key); exists only as the target
    -- of the composite foreign key below.
    CONSTRAINT bait_site_events_bait_site_id_id_key UNIQUE (bait_site_id, id),
    -- The identified capture must belong to the same site (ADR 0005, rule 4).
    -- MATCH SIMPLE (the default) skips the check when identified_event_id is null.
    CONSTRAINT bait_site_events_identified_event_fkey FOREIGN KEY (bait_site_id, identified_event_id)
        REFERENCES bait_site_events (bait_site_id, id),
    CONSTRAINT bait_site_events_event_type_check CHECK (event_type IN (
        'INSTALLED', 'ACTIVITY', 'CAPTURED', 'LOST', 'COLLECTED', 'REMOVED', 'INSPECTED', 'IDENTIFIED'
    )),
    -- Species only on CAPTURED (optional) and IDENTIFIED (required).
    CONSTRAINT bait_site_events_species_id_check CHECK (
        species_id IS NULL OR event_type IN ('CAPTURED', 'IDENTIFIED')
    ),
    CONSTRAINT bait_site_events_identified_species_check CHECK (
        event_type <> 'IDENTIFIED' OR species_id IS NOT NULL
    ),
    -- identified_event_id is set if and only if the event is IDENTIFIED.
    CONSTRAINT bait_site_events_identified_event_id_check CHECK (
        (event_type = 'IDENTIFIED') = (identified_event_id IS NOT NULL)
    ),
    -- The foreign key alone would accept a row pointing to itself.
    CONSTRAINT bait_site_events_identified_event_not_self_check CHECK (identified_event_id <> id),
    CONSTRAINT bait_site_events_voided_check CHECK ((voided_at IS NULL) = (voided_by IS NULL))
);

-- Supports "latest event per site" for the derived status (ADR 0005).
CREATE INDEX bait_site_events_bait_site_id_occurred_at_idx ON bait_site_events (bait_site_id, occurred_at DESC);
