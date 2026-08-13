-- A published Shadow Recommendation Set is an exact, versioned ordered
-- collection. Rebuilding publishes a new Set; it must never rewrite or remove
-- a member from the current or superseded version.

create or replace function
  catalog_private.reject_published_recommendation_member_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and exists (
      select 1
      from catalog_private.recommendation_sets as recommendation_set
      where recommendation_set.id = old.recommendation_set_id
        and recommendation_set.status in ('current', 'superseded')
    )
  then
    raise exception 'Published Recommendation Set members are immutable';
  end if;

  if tg_op in ('INSERT', 'UPDATE') and exists (
      select 1
      from catalog_private.recommendation_sets as recommendation_set
      where recommendation_set.id = new.recommendation_set_id
        and recommendation_set.status in ('current', 'superseded')
    )
  then
    raise exception 'Published Recommendation Set members are immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger published_recommendation_members_immutable_trg
before insert or update or delete on catalog_private.recommendations
for each row execute function
  catalog_private.reject_published_recommendation_member_mutation();
