-- Analyze citation ranges, diagnostics, and per-claim coverage from trusted
-- assistant text. The text is materialized as one Unicode character array;
-- disjoint top-level bracket ranges are sliced once and nested pairs are never
-- promoted out of their malformed outer range.

create function project_private.project_grounded_citation_analysis_v2(
  p_assistant_content text,
  p_source_manifest jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  chars text[];
  n integer;
  i integer := 0;
  ch text;
  next_ch text;
  depth integer := 0;
  bracket_start integer := 0;
  outside_start integer := 1;
  candidate_chars text[];
  candidate text;
  citation_match text[];
  start_seconds bigint;
  end_seconds bigint;
  diagnostics jsonb := '[]'::jsonb;
  outside_diagnostics jsonb;
  valid_count integer := 0;
  valid_source_ids jsonb := '[]'::jsonb;
  claim_start integer := 1;
  claim_prose text;
  claim_has_prose boolean := false;
  claim_has_valid boolean := false;
  has_claim boolean := false;
  all_claims_cited boolean := true;
  citation_like boolean;
begin
  if p_assistant_content is null
    or pg_catalog.char_length(p_assistant_content) not between 1 and 20000
    or pg_catalog.jsonb_typeof(p_source_manifest) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_source_manifest -> 'sources')
      is distinct from 'array'
  then
    return null;
  end if;
  chars := pg_catalog.regexp_split_to_array(p_assistant_content, '');
  n := pg_catalog.cardinality(chars);

  foreach ch in array chars loop
    i := i + 1;
    next_ch := case when i < n then chars[i + 1] else null end;
    if ch = '[' then
      if depth = 0 then
        if i > outside_start
          and pg_catalog.jsonb_array_length(diagnostics) < 20
        then
          outside_diagnostics :=
            project_private.project_grounded_unbracketed_diagnostics_v2(
              pg_catalog.array_to_string(chars[outside_start:i - 1], ''),
              20 - pg_catalog.jsonb_array_length(diagnostics)
            );
          if outside_diagnostics is null then return null; end if;
          diagnostics := diagnostics || outside_diagnostics;
        end if;
        bracket_start := i;
      end if;
      depth := depth + 1;
      continue;
    end if;
    if ch <> ']' or depth = 0 then
      if depth = 0 then
        if ch ~ '[[:alnum:]]' then claim_has_prose := true; end if;
        if ch = E'\n'
          or (ch in ('.', '!', '?', chr(12290), chr(65281), chr(65311))
            and (next_ch is null or next_ch ~ '[[:space:]]'))
        then
          claim_prose := pg_catalog.array_to_string(chars[claim_start:i], '');
          if claim_has_prose
            and claim_prose !~* '^[[:space:]]*(#{1,6}[[:space:]]*)?(project assessment|source-supported observations|proposed questions and creative opportunities|repeated evidence|model interpretation|agreements|disagreements|competing positions|criteria|confidence([[:space:]]*:[[:space:]]*(high|medium|low))?)[[:space:]]*:?[[:space:]]*$'
          then
            has_claim := true;
            if not claim_has_valid then all_claims_cited := false; end if;
          end if;
          claim_start := i + 1;
          claim_has_prose := false;
          claim_has_valid := false;
        end if;
      end if;
      continue;
    end if;
    depth := depth - 1;
    if depth > 0 then continue; end if;

    outside_start := i + 1;
    candidate_chars := chars[bracket_start:i];
    candidate := pg_catalog.array_to_string(candidate_chars, '');
    citation_like := candidate ~* '(^|[^A-Za-z0-9_])S[0-9]+'
      or candidate ~ '@[[:space:]]*[0-9]';
    citation_match := null;
    if pg_catalog.cardinality(candidate_chars) <= 80 then
      citation_match := pg_catalog.regexp_match(
        candidate,
        '^\[(S[0-9]{1,2}) @ (([0-9]{2}:)?[0-9]{2}:[0-9]{2})([-'
          || chr(8211)
          || '](([0-9]{2}:)?[0-9]{2}:[0-9]{2}))?\]$'
      );
    end if;

    if citation_match is null then
      if citation_like and pg_catalog.jsonb_array_length(diagnostics) < 20 then
        diagnostics := diagnostics || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'kind', 'malformed', 'raw', pg_catalog.left(candidate, 80)
          )
        );
      end if;
      continue;
    end if;

    start_seconds :=
      project_private.project_grounded_timestamp_seconds_v2(citation_match[2]);
    end_seconds :=
      project_private.project_grounded_timestamp_seconds_v2(citation_match[5]);
    if not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_source_manifest -> 'sources')
        as source_row(source)
      where source_row.source ->> 'sourceId' = citation_match[1]
    ) then
      if pg_catalog.jsonb_array_length(diagnostics) < 20 then
        diagnostics := diagnostics || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'kind', 'unknown_source',
            'raw', pg_catalog.left(candidate, 80),
            'sourceId', citation_match[1]
          )
        );
      end if;
    elsif start_seconds is null
      or (citation_match[5] is not null
        and (end_seconds is null or end_seconds <= start_seconds))
      or not exists (
        select 1
        from pg_catalog.jsonb_array_elements(p_source_manifest -> 'sources')
          as source_row(source)
        cross join lateral pg_catalog.jsonb_array_elements(
          source_row.source -> 'passages'
        ) as passage_row(passage)
        where source_row.source ->> 'sourceId' = citation_match[1]
          and pg_catalog.floor(
            (passage_row.passage ->> 'startSeconds')::numeric
          )::bigint = start_seconds
          and (
            citation_match[5] is null
            or (
              passage_row.passage -> 'endSeconds' <> 'null'::jsonb
              and pg_catalog.floor(
                (passage_row.passage ->> 'endSeconds')::numeric
              )::bigint = end_seconds
            )
          )
      )
    then
      if pg_catalog.jsonb_array_length(diagnostics) < 20 then
        diagnostics := diagnostics || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'kind', 'timestamp_not_in_evidence',
            'raw', pg_catalog.left(candidate, 80),
            'sourceId', citation_match[1]
          )
        );
      end if;
    else
      valid_count := valid_count + 1;
      if not (valid_source_ids ? citation_match[1]) then
        valid_source_ids := valid_source_ids
          || pg_catalog.jsonb_build_array(citation_match[1]);
      end if;
      claim_has_valid := true;
    end if;
  end loop;

  if depth > 0 then
    candidate := pg_catalog.array_to_string(chars[bracket_start:n], '');
    citation_like := candidate ~* '(^|[^A-Za-z0-9_])S[0-9]+'
      or candidate ~ '@[[:space:]]*[0-9]';
    if citation_like and pg_catalog.jsonb_array_length(diagnostics) < 20 then
      diagnostics := diagnostics || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind', 'malformed', 'raw', pg_catalog.left(candidate, 80)
        )
      );
    end if;
  elsif outside_start <= n
    and pg_catalog.jsonb_array_length(diagnostics) < 20
  then
    outside_diagnostics :=
      project_private.project_grounded_unbracketed_diagnostics_v2(
        pg_catalog.array_to_string(chars[outside_start:n], ''),
        20 - pg_catalog.jsonb_array_length(diagnostics)
      );
    if outside_diagnostics is null then return null; end if;
    diagnostics := diagnostics || outside_diagnostics;
  end if;

  claim_prose := case when claim_start <= n
    then pg_catalog.array_to_string(chars[claim_start:n], '')
    else '' end;
  if claim_has_prose
    and claim_prose !~* '^[[:space:]]*(#{1,6}[[:space:]]*)?(project assessment|source-supported observations|proposed questions and creative opportunities|repeated evidence|model interpretation|agreements|disagreements|competing positions|criteria|confidence([[:space:]]*:[[:space:]]*(high|medium|low))?)[[:space:]]*:?[[:space:]]*$'
  then
    has_claim := true;
    if not claim_has_valid then all_claims_cited := false; end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'validCitationCount', valid_count,
    'validSourceIds', valid_source_ids,
    'diagnostics', diagnostics,
    'allClaimsCited', has_claim and all_claims_cited
  );
exception when others then
  return null;
end;
$$;

revoke all on function
  project_private.project_grounded_citation_analysis_v2(text, jsonb)
  from public, anon, authenticated, service_role;
