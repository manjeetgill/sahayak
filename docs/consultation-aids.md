# Consultation aids

Open a patient record and choose **Visit**.

## Reported symptoms

The doctor can search and select common reported symptoms, or type any other symptom. **Add to note** puts the selections under Complaint for the doctor to review. This is a starting list, not a complete medical terminology system. A symptom never selects a diagnosis or medicine.

## Medicine names and prescription

**New prescription → Pick medicines** opens a searchable list of example generic names and the doctor's own saved names. The doctor can add a name while prescribing or manage saved names under **My visit shortcuts → My medicine names**. This lookup does not report pharmacy stock, map brands to ingredients, suggest treatment, or fill doses. The doctor chooses each medicine and enters dose, frequency and duration. **Create draft** uses the existing prescription review, exact-name allergy warnings, password-confirmed signature, numbered PDF and verification code. The original free-text and favourite-line method remains available.

The starter list is deliberately short and name-only. For the national reference, consult the [CDSCO National List of Essential Medicines](https://cdsco.mohfw.gov.in/opencms/opencms/en/consumer/Essential-Medicines/). A name on any list is not a recommendation for this patient. Existing exact-name warnings are limited and do not establish safety; see [WHO Medication Safety in High-Risk Situations](https://iris.who.int/bitstream/handle/10665/325131/WHO-UHC-SDS-201910-eng.pdf?sequence=1).

## Conversation capture

**Capture a consultation with patient consent** uses the browser's speech recognition. The doctor records the patient's agreement before the microphone starts, chooses Patient or Doctor for each speaking turn, stops capture, checks the transcript and arranges a draft note. Switching speakers ends the current recognition turn before starting the next. Sahayak stores the transcript and consent record, not an audio file. The browser's speech service may process audio. Patient speech stays in the reported complaint; only explicitly doctor-labelled sections can become findings, diagnosis or plan. No prescription is produced from the conversation. The doctor checks, edits and signs the note.

The doctor can use typed notes or the existing one-person dictation without conversation capture. Real microphone quality, Hindi/Hinglish accuracy and consent wording still need an observed clinic pilot; automated tests do not validate speech recognition quality.

## Verification

The isolated browser journey covers symptom selection, a signed note, structured prescription fields and a signed PDF-backed prescription. Core integration tests cover clinic isolation, consent records and doctor-only medicine-list management. Scribe tests check that patient statements do not become findings or a treatment plan.
