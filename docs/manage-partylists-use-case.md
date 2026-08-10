# Manage Partylists

**Users:** Admin

**Manage Partylists**
|-- <<extend>> Create Partylist
|   |-- <<include>> Enter Partylist Information
|   |-- <<extend>> Upload Partylist Image
|   `-- <<include>> Save Record
|-- <<extend>> Update Partylist
|   |-- <<include>> Edit Partylist Information
|   `-- <<include>> Save Record
|-- <<extend>> View Partylist Members
`-- <<extend>> Remove Partylist
    |-- <<include>> Confirm Removal
    `-- <<include>> Record Audit Log

## Implementation Coverage

- **Role Access:** Admin-only frontend routes, sidebar visibility, and API middleware protect partylist create, update, and delete.
- **Create Partylist:** `ManagePartylistsPage` captures name, acronym, description, and optional banner image, then saves the record.
- **Upload Partylist Image:** partylist create/update supports JPEG, PNG, JPG, and WebP banner uploads.
- **Update Partylist:** the edit drawer loads current partylist details and saves updated identity/banner information.
- **View Partylist Members:** the page displays assigned candidates for each partylist and shows the roster in the edit view.
- **Remove Partylist:** deletion requires confirmation and is blocked when candidates are assigned.
- **Record Audit Log:** partylist removal writes an `elections` audit log entry through `ElectionController`.
