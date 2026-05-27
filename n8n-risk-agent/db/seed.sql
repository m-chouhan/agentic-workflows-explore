-- ═══════════════════════════════════════════════════════════════════
-- Risk Factor Agent — Seed Data
-- 15 sample feature weights across 4 categories
-- Scale: 0 = safest, 10 = riskiest
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO feature_weights (feature, category, weight, description) VALUES

-- ── Country Risk ──────────────────────────────────────────────────
('country:UAE',         'country', 2, 'Stable Gulf economy, strong FDI inflows, low geopolitical friction'),
('country:India',       'country', 3, 'High growth, some regulatory unpredictability, border tensions managed'),
('country:USA',         'country', 2, 'Reserve currency, political polarisation risk rising'),
('country:China',       'country', 5, 'Regulatory crackdowns, Taiwan strait tension, export controls'),
('country:Russia',      'country', 9, 'Ongoing war, heavy sanctions, capital flight'),

-- ── Industry Risk ─────────────────────────────────────────────────
('industry:Oil',        'industry', 6, 'OPEC+ supply decisions, demand fragility, energy transition pressure'),
('industry:Shipping',   'industry', 5, 'Red Sea disruptions, port congestion cycles, fuel cost volatility'),
('industry:Tech',       'industry', 3, 'AI-driven growth, antitrust scrutiny in EU/US, chip export controls'),
('industry:Banking',    'industry', 4, 'Rate cycle risk, credit quality concerns, regulatory capital pressure'),
('industry:Defence',    'industry', 4, 'Tailwinds from geopolitical tension, budget dependency risk'),

-- ── Sector Risk ───────────────────────────────────────────────────
('sector:Semiconductors', 'sector', 6, 'US-China export controls, TSMC concentration, cyclical demand'),
('sector:RealEstate',     'sector', 6, 'High-rate environment pressure, China property overhang'),
('sector:Crypto',         'sector', 8, 'Regulatory uncertainty, high volatility, correlation with risk-off'),

-- ── Macro Risk ────────────────────────────────────────────────────
('macro:Inflation',     'macro', 5, 'Stickier than expected in services, central banks still cautious'),
('macro:USD_Strength',  'macro', 4, 'Strong USD pressures EM economies, commodity pricing distortion')

ON CONFLICT (feature) DO NOTHING;
