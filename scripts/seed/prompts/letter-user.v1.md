Payer: {{payer_name}}
Criteria set: {{criteria_label}}, version {{criteria_version}}
Determination: Adverse determination, {{category_label}}
Member ID: {{member_id}}
Claim number: {{claim_number}}
Service: Inpatient admission for {{condition_label}}, DRG {{drg}}, from [[ADMIT_DATE]] to [[DISCHARGE_DATE]]
Claim adjustment codes: CARC {{carc}}, RARC {{rarc}}

Payer's overall rationale:
{{root_cause_statement}}

Criteria the payer found not met, each with the payer's finding:
{{cited_findings}}

Appeal instructions to include:
{{appeal_instructions}} Appeals must be received by [[APPEAL_DEADLINE]].

Signature: {{signature_role}}

Return the JSON object only.
