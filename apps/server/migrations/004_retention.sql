-- Which stored documents belong to which claim (receipt images and supporting documents), for the retention job.
CREATE VIEW claim_documents_v AS
  SELECT cr.claim_id, r.document_id FROM claim_receipts cr JOIN receipts r ON r.id = cr.receipt_id
  UNION
  SELECT claim_id, document_id FROM claim_required_docs WHERE document_id IS NOT NULL;
