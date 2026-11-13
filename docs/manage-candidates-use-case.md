# Manage Candidates

**Users:** Admin (writes), SBO Officer (read only), Student (files)

**Manage Candidates**
|-- <<extend>> File Candidacy (student)
|   |-- <<include>> Read and Accept Official Rules
|   |-- <<include>> Choose Position
|   |-- <<include>> Upload Formal Photo, Certificate of Candidacy and Credentials
|   |-- <<extend>> Add Campaign Platform
|   |-- <<extend>> File as a Party List (representative)
|   `-- <<include>> Submit for Screening
|-- <<extend>> Withdraw Candidacy (student)
|-- <<include>> Screen Application (Admin)
|   |-- <<extend>> Approve
|   |-- <<extend>> Ask for Correction
|   `-- <<extend>> Reject
|-- <<extend>> Register Candidate (Admin, short form only)
|   |-- <<include>> Enter Candidate Information
|   |-- <<include>> Assign Election Position
|   |-- <<extend>> Assign Candidate to Partylist
|   |-- <<extend>> Upload Candidate Image
|   `-- <<include>> Save Record
|-- <<extend>> Update Candidate (Admin, short form only)
`-- <<extend>> Remove Candidate (Admin, short form only)
    |-- <<include>> Confirm Removal
    `-- <<include>> Record Audit Log

## Two paths

An election where **Students file their own candidacy** is on has no Add, Edit or Remove for candidates. The official list is made of approved applications, and the Candidates page says "Candidates of this election come from approved applications." with a link to the Applications step. An election created with the switch off keeps the short form: the Admin registers candidates directly (this is the path the exhibit demo uses).

## Implementation Coverage

- **Role Access:** the Admin and the SBO Officer can open the Candidates and Applications pages. Creating, updating and removing a candidate is Admin only; an officer sees every list read only on every election. Students reach filing through Election information.
- **Who may run:** a voting member of the organization who is not its faculty adviser. A student files for one position only; one candidacy per student per election. A withdrawn application can be filed again while filing is open; a rejected one cannot.
- **Eligibility:** the system enforces organization membership, one candidacy, the position's eligible year levels, and refuses a fourth year (or higher) student for an executive position with "Fourth year students cannot run for an executive position." A student with no year level on record may file; the Admin sees "Year level not on record". Minimum units, GPA and conduct are shown as requirements and checked by the Admin from the uploaded credentials.
- **File Candidacy:** on the Election information page the student reads the rules, ticks "I have read and accept the official rules", then chooses **File as an individual** or **File a party list**. Individual filing needs a position, a formal photo (JPEG, PNG or WebP, up to 2 MB), a Certificate of Candidacy and Credentials (PDF, JPG or PNG, up to 10 MB each); a campaign platform is optional. **Save draft** keeps it; **Submit** sends it to screening. Drafts never submitted are withdrawn when filing closes.
- **File as a Party List:** the representative gives a party list name, motto and color (banner optional), adds one member per position with the same documents, may leave seats vacant, then selects **Submit party list**. Each member is screened separately.
- **Private documents:** the Certificate of Candidacy and Credentials are private files on the local disk, opened through the API by the applicant, the representative or the Admin only. The formal photo is stored on the public disk with the other candidate photos.
- **Screen Application:** during Screening the Admin sees one table (Candidate, Position, Party list, Documents, Status). **Approve** adds the candidate to the official list. **Ask for correction** needs notes; the candidate or representative replaces only the documents and the application returns to Pending review. **Reject** needs a reason. Corrections not completed before screening ends are rejected automatically with "Corrections were not completed before screening closed". Applications still Pending review hold the election in Screening and alert the Admin.
- **Withdraw Candidacy:** the applicant (or the representative for a member) may withdraw until voting opens. An approved candidate leaves the official list.
- **Register Candidate (short form):** `ManageCandidatesPage` captures student, election position, optional party list, platform, and optional image upload. Candidate create and update validate that the position belongs to the selected election and that the party list belongs to the organization.
- **Remove Candidate (short form):** deletion requires confirmation and is blocked when votes exist. It writes an `elections` audit log entry through `ElectionController`.
- **Campaign:** approved candidates are public to members from the Campaign phase with party list name, motto, color and banner.
- **Notifications:** the Admins are told when an application is submitted; the candidate (and the representative) is told of each decision; a student listed as a party list member is told.
