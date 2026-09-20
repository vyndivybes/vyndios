-- OS audit remediation: canonical VYNDI brand identity.
-- Historical audit/document text is intentionally preserved; only current
-- canonical product master display names are corrected.

with corrected as (
  update vyndi_product_families
     set display_name=regexp_replace(display_name,'^VINDY ','VYNDI '),
         updated_at=now()
   where display_name like 'VINDY %'
  returning family_code,display_name
)
insert into vyndi_audit_events(
  id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json
)
select
  'AUD-BRAND-FAMILY-'||family_code,
  'product_family',
  family_code,
  'canonical_brand_corrected',
  'system:migration',
  'system',
  'OS-AUDIT-2026-09-20',
  jsonb_build_object('displayName',display_name,'brand','VYNDI')
from corrected
on conflict do nothing;

with corrected as (
  update vyndi_product_variants
     set display_name=regexp_replace(display_name,'^VINDY ','VYNDI '),
         updated_at=now()
   where display_name like 'VINDY %'
  returning variant_id,display_name
)
insert into vyndi_audit_events(
  id,entity_type,entity_id,action,actor_user_id,actor_role,source_reference,payload_json
)
select
  'AUD-BRAND-VARIANT-'||substr(md5(variant_id),1,20),
  'product_variant',
  variant_id,
  'canonical_brand_corrected',
  'system:migration',
  'system',
  'OS-AUDIT-2026-09-20',
  jsonb_build_object('displayName',display_name,'brand','VYNDI')
from corrected
on conflict do nothing;
