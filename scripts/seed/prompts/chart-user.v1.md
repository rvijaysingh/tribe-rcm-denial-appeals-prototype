Patient: {{age}}-year-old {{sex}}
Working diagnosis: {{condition_label}}
Length of stay: {{los_days}} days, discharged on HD{{los_days}}

Write these documents, in this order, with these doc_type values:
{{document_plan}}

DOCUMENT these findings. Place each one where it would naturally be charted. Keep the numbers as given. The key term in brackets must appear verbatim.
{{document_findings}}

OMIT the following entirely:
{{omit_findings}}

Return the JSON object only.
