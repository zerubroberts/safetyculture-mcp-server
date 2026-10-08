# Mitti API endpoint index

Generated from https://developer.mitti.com/llms.txt reference pages. Format: `METHOD path` - summary - slug (use `node scripts/api-ref.mjs <slug>` for fields).


## Actions
- `POST /tasks/v1/actions` - Create an action - actionsservice_createaction
- `PUT /tasks/v1/actions/{action_id}/label` - Updates the labels associated with an action - actionsservice_updateactionlabels
- `GET /tasks/v1/actions/{id}` - Get an Action - actionsservice_getaction
- `PUT /tasks/v1/actions/{task_id}/asset` - Update the asset of an action - actionsservice_updateasset
- `PUT /tasks/v1/actions/{task_id}/assignees` - Update the assignees of an action - actionsservice_updateassignees
- `PUT /tasks/v1/actions/{task_id}/description` - Update the description of an action - actionsservice_updatedescription
- `PUT /tasks/v1/actions/{task_id}/due_at` - Update the due date of an action - actionsservice_updatedueat
- `PUT /tasks/v1/actions/{task_id}/priority` - Update the priority of an action - actionsservice_updatepriority
- `POST /tasks/v1/actions/{task_id}/shared_link` - Create an action link - actionsservice_createactionsharedlink
- `GET /tasks/v1/actions/{task_id}/shared_link` - Get an action link - actionsservice_getactionsharedlink
- `DELETE /tasks/v1/actions/{task_id}/shared_link` - Delete an action link - actionsservice_revokeactionsharedlink
- `PUT /tasks/v1/actions/{task_id}/site` - Update the site of an action - actionsservice_updatesite
- `PUT /tasks/v1/actions/{task_id}/status` - Update the status of an action - actionsservice_updatestatus
- `PUT /tasks/v1/actions/{task_id}/title` - Update the title of an action - actionsservice_updatetitle
- `POST /tasks/v1/actions/delete` - Delete actions (Bulk) - actionsservice_deleteactions
- `POST /tasks/v1/actions/list` - List actions - actionsservice_getactions
- `POST /tasks/v1/actions/schedule` - Create an action with recurring schedule - actionsservice_createactionschedule
- `PUT /tasks/v1/customer_configuration/{type_id}/custom_field/{field_id}` - Map a field to a action type - customerconfigurationservice_mapfieldtotasktype
- `DELETE /tasks/v1/customer_configuration/{type_id}/custom_field/{field_id}` - Unmap a field from a action type - customerconfigurationservice_unmapfieldfromtasktype
- `GET /tasks/v1/customer_configuration/{type_id}/custom_fields/mapped` - Get all custom fields mapped to a specific action type - customerconfigurationservice_gettasktypecustomfields
- `GET /tasks/v1/customer_configuration/{type_id}/custom_fields/unmapped` - Get the custom fields not mapped to a specific action type - customerconfigurationservice_getorgtasktypeunmappedfields
- `GET /tasks/v1/customer_configuration/action_labels` - Get all action labels - customerconfigurationservice_getactionlabels
- `POST /tasks/v1/customer_configuration/action_labels/delete` - Delete action labels - customerconfigurationservice_deleteactionlabels
- `PUT /tasks/v1/customer_configuration/action_labels/upsert` - Create or update an action label - customerconfigurationservice_upsertactionlabel
- `DELETE /tasks/v1/customer_configuration/custom_field/{id}` - Delete a custom field - customerconfigurationservice_deletecustomfield
- `PUT /tasks/v1/customer_configuration/custom_field/{id}` - Rename a custom field - customerconfigurationservice_renamecustomfield
- `POST /tasks/v1/customer_configuration/custom_field/{type_id}` - Create a custom field and map it to a specific action type - customerconfigurationservice_createcustomfield
- `POST /tasks/v1/customer_configuration/task_type` - Create an action type - customerconfigurationservice_createtasktype
- `DELETE /tasks/v1/customer_configuration/task_type/{id}` - Delete an action type - customerconfigurationservice_deletetasktype
- `GET /tasks/v1/customer_configuration/task_type/{id}` - Get a single action type by id - customerconfigurationservice_gettasktype
- `PUT /tasks/v1/customer_configuration/task_type/{id}` - Rename an action type - customerconfigurationservice_renametasktype
- `GET /tasks/v1/customer_configuration/task_types` - List all action types for the org - customerconfigurationservice_gettasktypes
- `PUT /tasks/v1/tasks/{task_id}/custom_field` - Update a custom field for an Action - tasksservice_updatetaskcustomfield

## Apps
- `GET /integrations/v1/apps` - List applications - partnerintegrationservice_listapplications
- `POST /integrations/v1/apps` - Register a new external application - partnerintegrationservice_registerapplication
- `PUT /integrations/v1/apps/{app_id}` - Update an external application - partnerintegrationservice_updateapplication
- `POST /integrations/v1/apps/{app_id}/installations` - Create an installation - partnerintegrationservice_createinstallation
- `DELETE /integrations/v1/apps/{app_id}/installations/{installation_id}` - Delete an installation - partnerintegrationservice_deleteinstallation
- `GET /integrations/v1/apps/{app_id}/installations/{installation_id}` - Get installation - partnerintegrationservice_getinstallation
- `POST /integrations/v1/apps/{app_id}/installations/{installation_id}/configurations` - Create configuration - partnerintegrationservice_createconfiguration
- `DELETE /integrations/v1/apps/{app_id}/installations/{installation_id}/configurations/{configuration_id}` - Delete the configuration - partnerintegrationservice_deleteconfiguration
- `PUT /integrations/v1/apps/{app_id}/installations/{installation_id}/configurations/{configuration_id}` - Update the configuration - partnerintegrationservice_updateconfiguration
- `GET /integrations/v1/apps/installations` - List all installations - partnerintegrationservice_listinstallations

## Assets
- `POST /assets/v1/assets` - Create an asset - assetsservice_createasset
- `GET /assets/v1/assets:GetAssetByCode` - Get asset by code - assetsservice_getassetbycode
- `POST /assets/v1/assets:LookupAssetsByField` - Lookup assets by a field - assetsservice_lookupassetsbyfield
- `PATCH /assets/v1/assets/{asset_id}/fields` - Set field values of an asset - assetsservice_setassetfieldvalues
- `DELETE /assets/v1/assets/{id}` - Delete an asset - assetsservice_deleteasset
- `GET /assets/v1/assets/{id}` - Get full detail information of an asset - assetsservice_getasset
- `PATCH /assets/v1/assets/{id}` - Update an asset - assetsservice_updateasset
- `PATCH /assets/v1/assets/{id}/archive` - Archive an asset - assetsservice_archiveasset
- `DELETE /assets/v1/assets/{id}/archive` - Restore an archived asset - assetsservice_restorearchivedasset
- `PATCH /assets/v1/assets/{id}/location` - Update asset location - assetsservice_updateassetlocation
- `POST /assets/v1/assets/bulk` - Create multiple assets - assetsservice_bulkcreateassets
- `PUT /assets/v1/assets/bulk` - Update multiple assets - assetsservice_bulkupdateassets
- `POST /assets/v1/assets/list` - List assets - assetsservice_listassets
- `POST /assets/v1/fields` - Create an asset field - fieldsservice_createfield
- `DELETE /assets/v1/fields/{id}` - Delete an asset field - fieldsservice_deletefield
- `PATCH /assets/v1/fields/{id}` - Update an asset field - fieldsservice_updatefield
- `POST /assets/v1/fields/list` - List asset fields - fieldsservice_listfields
- `POST /assets/v1/maintenance/asset/{asset_id}/service` - Add maintenance last service information to an asset. - maintenanceservice_addassetlastservice
- `POST /assets/v1/maintenance/asset/{asset_id}/service-history` - List asset service history - maintenanceservice_listassetservicehistory
- `POST /assets/v1/maintenance/assets/details` - List assets maintenance details - maintenanceservice_listassetsmaintenancedetails
- `POST /assets/v1/maintenance/assets/status-counts` - Return the count of assets in each maintenance status. - maintenanceservice_listassetsmaintenancestatuscounts
- `DELETE /assets/v1/maintenance/plan/{id}` - Delete a maintenance plan - maintenanceservice_deleteplan
- `PUT /assets/v1/maintenance/plan/{plan.id}` - Update a maintenance plan - maintenanceservice_updateplan
- `POST /assets/v1/maintenance/program` - Create a maintenance program - maintenanceservice_createprogram
- `GET /assets/v1/maintenance/program` - Get a maintenance program - maintenanceservice_getprogram
- `DELETE /assets/v1/maintenance/program/{id}` - Delete a maintenance program - maintenanceservice_deleteprogram
- `POST /assets/v1/maintenance/program/{id}/assets` - Add assets to a maintenance program - maintenanceservice_addassetstoprogram
- `DELETE /assets/v1/maintenance/program/{id}/assets` - Remove assets from a maintenance program - maintenanceservice_removeassetsfromprogram
- `POST /assets/v1/maintenance/program/{program_id}/plan` - Create a maintenance plan - maintenanceservice_createplan
- `PUT /assets/v1/maintenance/program/{program.id}` - Update a maintenance program - maintenanceservice_updateprogram
- `POST /assets/v1/maintenance/program/details` - List maintenance program details - maintenanceservice_listprogramsdetails
- `POST /assets/v1/status-groups` - Create a status group - statusgroupsservice_createstatusgroup
- `DELETE /assets/v1/status-groups/{id}` - Delete a status group - statusgroupsservice_deletestatusgroup
- `GET /assets/v1/status-groups/{id}` - Get a status group - statusgroupsservice_getstatusgroup
- `POST /assets/v1/status-groups/{id}/types` - Add a status group to asset types - statusgroupsservice_addstatusgrouptoassettypes
- `DELETE /assets/v1/status-groups/{id}/types` - Remove a status group from asset types - statusgroupsservice_removestatusgroupfromassettypes
- `PATCH /assets/v1/status-groups/{status_group.id}` - Update a status group - statusgroupsservice_updatestatusgroup
- `POST /assets/v1/status-groups/list` - List status groups - statusgroupsservice_liststatusgroups
- `POST /assets/v1/types` - Create an asset type - typesservice_createtype
- `DELETE /assets/v1/types/{id}` - Delete an asset type - typesservice_deletetype
- `GET /assets/v1/types/{id}` - Get an asset type - typesservice_gettype
- `PATCH /assets/v1/types/{id}` - Update an asset type - typesservice_updatetype
- `PUT /assets/v1/types/{type_id}/fields` - Update an asset type's asset field associations - typesservice_updatetypefields
- `POST /assets/v1/types/{type_id}/fields/list` - List an asset type's asset field associations - typesservice_listtypefields
- `POST /assets/v1/types/list` - List asset types - typesservice_listtypes

## Bulk user operations
- `POST /users/v1/users/upsert` - Create or update users synchronously - usersservice_createorupdateusers
- `POST /users/v1/users/upsert/jobs` - Initialize a create-or-update users job - usersservice_initcreateorupdateusersjob
- `DELETE /users/v1/users/upsert/jobs/{job_id}` - Cancel a create-or-update users job - usersservice_cancelcreateorupdateusersjob
- `GET /users/v1/users/upsert/jobs/{job_id}` - Get a create-or-update users job - usersservice_getcreateorupdateusersjob
- `POST /users/v1/users/upsert/jobs/{job_id}` - Start a create-or-update users job - usersservice_startcreateorupdateusersjob
- `POST /users/v1/users/upsert/jobs/list` - List create-or-update users jobs - usersservice_listcreateorupdateusersjobs

## Companies
- `POST /companies/v1/companies` - List companies - contractorsservice_listcontractorcompanies
- `POST /companies/v1/company` - Create a company - contractorsservice_createcontractorcompany
- `DELETE /companies/v1/company` - Delete a company - contractorsservice_deletecontractorcompany
- `GET /companies/v1/company` - Get a company - contractorsservice_getcontractorcompany
- `PUT /companies/v1/company` - Update a company - contractorsservice_updatecontractorcompany
- `POST /companies/v1/documents` - List company documents - companydocumentsservice_listcompanydocuments
- `DELETE /companies/v1/documents/type` - Delete a company document type - companydocumentsservice_deletecompanydocumenttype
- `POST /companies/v1/documents/types` - List company document types - companydocumentsservice_listcompanydocumenttypes
- `POST /companies/v1/type-metrics` - List company type metrics - contractorcompanytypesservice_listcompanytypesmetrics
- `GET /companies/v1/type/{id}` - Get a company type - contractorcompanytypesservice_getcompanytype
- `POST /companies/v1/types` - List company types - contractorcompanytypesservice_listcompanytypes
- `POST /companies/v1/users` - List company users - contractorsservice_listcompanyusermetadata

## Credentials
- `DELETE /credentials/v1/credential` - Delete a credential including all its versions. - userdocumentsservice_deletedocumentforuser
- `POST /credentials/v1/credential-type` - Create a credential type - documenttypesservice_createdocumenttype
- `PUT /credentials/v1/credential-type` - Update a credential type - documenttypesservice_updatedocumenttype
- `DELETE /credentials/v1/credential-type/{id}` - Delete a credential type - documenttypesservice_deletedocumenttype
- `GET /credentials/v1/credential-type/{id}` - Get a credential type - documenttypesservice_getdocumenttype
- `POST /credentials/v1/credential-types` - List credential types - documenttypesservice_listdocumenttypes
- `POST /credentials/v1/credential/delete-media` - Delete all media for a credential version - userdocumentsservice_deleteallmediafordocumentversion
- `POST /credentials/v1/credential/version` - Add a version to a credential. - userdocumentsservice_adddocumentversionforuser
- `GET /credentials/v1/credential/version` - Get a version of a credential. - userdocumentsservice_getdocumentversion
- `PUT /credentials/v1/credential/version` - Update a version of a credential. - userdocumentsservice_updatedocumentversionforuser
- `POST /credentials/v1/credential/versions` - List all versions of a credential. - userdocumentsservice_getdocumenthistory
- `POST /credentials/v1/credentials` - List the latest version of credentials based on applied filters. - userdocumentsservice_getdocuments
- `GET /credentials/v1/settings` - Get the Credential settings for your organization. - userdocumentsservice_getsettings
- `PUT /credentials/v1/settings` - Update the Credential settings for your organization. - userdocumentsservice_updatesettings

## Data Feeds
- `GET /assets/v1/feed/assets_maintenance` - Data feed for assets maintenance details - feedservice_feedassetsmaintenance
- `GET /assets/v1/feed/maintenance_plans` - Data feed for maintenance plans - feedservice_feedmaintenanceplans
- `GET /assets/v1/feed/maintenance_programs` - Data feed for maintenance programs - feedservice_feedmaintenanceprograms
- `GET /companies/v1/feed/companies` - Data feed for contractor companies - feedservice_feedcontractorcompanies
- `GET /companies/v1/feed/companies/documents` - Data feed for contractor company documents - feedservice_feedcontractorcompanydocuments
- `GET /companies/v1/feed/companies/members` - Data feed for contractor company members - feedservice_feedcontractorcompanyusermemberships
- `GET /credentials/v1/feed/credential-types` - Data feed for credential types - feedservice_credentialtypes
- `GET /credentials/v1/feed/credentials` - Data feed for credentials - feedservice_credentials
- `GET /feed/action_assignees` - Data feed for action assignees - thepubservice_feedactionassignees
- `GET /feed/action_fields` - Data feed for action fields - feedservice_feedactionfields
- `GET /feed/action_timeline_items` - Data feed for action timeline items - thepubservice_feedactiontimelineitems
- `GET /feed/actions` - Data feed for actions - thepubservice_feedactions
- `GET /feed/activity_log_events` - Data feed for activity log events - thepubservice_feedactivitylogevents
- `GET /feed/assets` - Data feed for assets - thepubservice_feedassets
- `GET /feed/group_users` - Data feed for group users - thepubservice_feedgroupusers
- `GET /feed/groups` - Data feed for groups - thepubservice_feedgroups
- `GET /feed/inspection_items` - Data feed for inspection items - thepubservice_feedinspectionitems
- `GET /feed/inspections` - Data feed for inspections - thepubservice_feedinspections
- `GET /feed/issue_assignees` - Data feed for issue assignees - thepubservice_feedissueassignees
- `GET /feed/issue_relations` - Data feed for issue relations items - thepubservice_feedissuerelationships
- `GET /feed/issue_timeline_items` - Data feed for issue timeline items - thepubservice_feedissuetimelineitems
- `GET /feed/issues` - Data feed for issues - thepubservice_feedissues
- `GET /feed/schedule_assignees` - Data feed for schedule assignees (legacy) - thepubservice_feedscheduleassignees
- `GET /feed/schedule_occurrences` - Data feed for schedule occurrences (legacy) - thepubservice_feedscheduleoccurrences
- `GET /feed/schedules` - Data feed for Schedules (legacy) - thepubservice_feedschedules
- `GET /feed/site_members` - Data feed for site members - thepubservice_feedsitemembers
- `GET /feed/sites` - Data feed for sites - thepubservice_feedsites
- `GET /feed/template_permissions` - Data feed for template permissions - thepubservice_feedtemplatepermissions
- `GET /feed/templates` - Data feed for templates - thepubservice_feedtemplates
- `GET /feed/users` - Data feed for users - thepubservice_feedusers
- `GET /incidents/v1/feed/investigation_detail_fields` - Data feed for investigation detail fields - feedservice_feedinvestigationdetailfields
- `GET /incidents/v1/feed/investigation_fields` - Data feed for investigation fields - feedservice_feedinvestigationfields
- `GET /incidents/v1/feed/investigation_relationships` - Data feed for investigation relationships - feedservice_feedinvestigationrelationships
- `GET /incidents/v1/feed/investigations` - Data feed for investigations - feedservice_feedinvestigations
- `GET /scheduling/v1/feed/schedule_assignees` - Data feed for schedule assignees - schedulingfeedservice_feedscheduleassignees
- `GET /scheduling/v1/feed/schedule_occurrences` - Data feed for schedule occurrences - schedulingfeedservice_feedscheduleoccurrences
- `GET /scheduling/v1/feed/schedules` - Data feed for schedules - schedulingfeedservice_feedschedules
- `GET /tasks/v1/feed/action_fields` - Data feed for action fields - feedservice_feedactionfields2
- `GET /training/v1/feed/training-course-progress` - Data feed for Course Progress - feedservice_feedtrainingcourseprogress

## Directory (Sites)
- `POST /directory/v1/folder` - Create a folder - directory_createfolder
- `GET /directory/v1/folder/{id}` - Retrieve a folder - directory_getfolder
- `PATCH /directory/v1/folder/{id}` - Update a folder - directory_updatefolderproperties
- `GET /directory/v1/folder/{id}/users` - Retrieve users associated to a folder, includes both directly and
indirectly (inherited) - directory_getallusersbyfolder
- `DELETE /directory/v1/folder/{id}/users` - Remove association for multiple users to a specific folder - directory_removeusersassociation
- `GET /directory/v1/folder/{id}/users/associated` - Retrieve users directly associated to a folder - directory_getusersbyfolder
- `GET /directory/v1/folder/{id}/users/inherited` - Retrieve users indirectly associated (inherited) to a folder - directory_getinheritedusersbyfolder
- `DELETE /directory/v1/folders` - Delete folders (bulk) - directory_deletefolders
- `GET /directory/v1/folders` - List folders - directory_getfolders
- `POST /directory/v1/folders/move` - Move folder to another parent folder or as a root folder - directory_movefolders
- `POST /directory/v1/folders/search` - Search folders - directory_searchfolders
- `GET /directory/v1/organization/labels` - Get custom labels - directory_getorglabels
- `GET /directory/v1/parent/{id}/folders` - Get folders (by parent) - directory_getfoldersbyparent
- `DELETE /directory/v1/user/{user_id}/folders` - Remove association for a specific user to multiple folders - directory_removefoldersassociation
- `GET /directory/v1/user/folder_ids` - List folders the requesting user is associated with - directory_getfolderidsforuser
- `POST /directory/v1/users/folders/membership` - Associate users to folders - directory_addusersfoldersassociations

## Documents
- `POST /documents/v1` - Create a file - documentspublicservice_createfile
- `PATCH /documents/v1/{file_id}` - Update a file - documentspublicservice_updatefile
- `POST /documents/v1/archive/{item_id}` - Archive a file or folder - documentspublicservice_archiveitem
- `POST /documents/v1/bulk/add_owners` - Bulk add file owners - documentspublicservice_bulkaddfileowners
- `POST /documents/v1/bulk/remove_owners` - Bulk remove file owners - documentspublicservice_bulkremovefileowners
- `POST /documents/v1/bulk/update_owners` - Bulk update file owners - documentspublicservice_bulkupdatefileowners
- `POST /documents/v1/children` - Get folder items - documentspublicservice_getfolderchildren
- `POST /documents/v1/link` - Link files - documentspublicservice_linkfiles
- `POST /documents/v1/move/{item_id}` - Move a file or folder - documentspublicservice_moveitem
- `POST /documents/v1/search` - Search files and folders - documentspublicservice_searchitems

## Groups
- `POST /accounts/organisation/v1/accounts:BulkDeleteGroups` - Bulk delete groups - organisationservice_bulkdeletegroups
- `GET /accounts/organisation/v1/accounts/user/{user_id}/groups` - List groups for a user - organisationservice_getusergroups
- `POST /groups` - Create a group - thepubservice_creategroup
- `GET /groups` - List groups - thepubservice_listgroups
- `GET /groups/{group_id}/users` - List a group's or an organization's users - thepubservice_listusersingroup
- `DELETE /groups/{group_id}/users/{user_id}` - Remove user from a group - thepubservice_removeuser
- `POST /groups/{group_id}/users/v2` - Add user to a group - thepubservice_addnewusertogroup
- `GET /share/connections` - List calling user's groups and organizations - thepubservice_getusergroups

## Heads Up
- `GET /announcements/v1/announcement:GetHeadsUp` - Gets Heads Up - headsupservice_getheadsup
- `POST /announcements/v1/announcement:GetHeadsUpCompletionCounts` - Get Heads Up completion counts - headsupservice_getheadsupcompletioncounts
- `POST /announcements/v1/announcement:GetHeadsUpMessages` - Get a Heads Ups comments - headsupservice_getheadsupmessages
- `POST /announcements/v1/announcement:ListHeadsUpManage` - List Heads Ups - headsupservice_listheadsupmanage
- `POST /announcements/v1/announcement:ListHeadsUpUsers` - List Heads Up users - headsupservice_listheadsupusers

## Inspections
- `POST /audits` - Start an inspection - thepubservice_startinspection
- `GET /audits/{audit_id}` - Get an inspection (legacy) - thepubservice_getinspection
- `PUT /audits/{audit_id}` - Update an inspection - thepubservice_updateinspection
- `POST /audits/{audit_id}/deep_link` - Generate an inspection deep link - thepubservice_getinspectiondeeplink
- `GET /audits/{audit_id}/media/{media_id}` - Retrieve the selected media for a given inspection - thepubservice_getinspectionmedia
- `POST /audits/{audit_id}/share` - Share an inspection - thepubservice_shareinspection
- `DELETE /audits/{audit_id}/web_report_link` - Delete inspection web report link - thepubservice_deleteinspectionwebreportlink
- `GET /audits/{audit_id}/web_report_link` - Get inspection web report link - thepubservice_getinspectionwebreportlink
- `GET /audits/search` - Search modified inspections - thepubservice_searchinspections
- `POST /inspection/v1/export` - Export inspection to PDF or Word - reportsservice_startinspectionexport
- `POST /inspections/integration/v1/inspections` - Create inspection - inspectionservice_createinspection
- `PUT /inspections/integration/v1/inspections/{inspection_id}` - Update inspection - inspectionservice_updateinspection
- `GET /inspections/integration/v1/inspections/{inspection_id}/access` - Get inspection access - inspectionservice_getinspectionaccess
- `PUT /inspections/integration/v1/inspections/{inspection_id}/access` - Set inspection access - inspectionservice_setinspectionaccess
- `POST /inspections/integration/v1/inspections/{inspection_id}/complete` - Complete inspection - inspectionservice_completeinspection
- `POST /inspections/integration/v1/inspections/{inspection_id}/tables/{item_id}/lines` - Add table line - inspectionservice_addtableline
- `DELETE /inspections/integration/v1/inspections/{inspection_id}/tables/{item_id}/lines/{line_id}` - Delete table line - inspectionservice_deletetableline
- `PUT /inspections/integration/v1/inspections/{inspection_id}/tables/{item_id}/lines/{line_id}` - Update table line - inspectionservice_updatetableline
- `GET /inspections/v1/answers/{id}` - Get answers from an inspection - answerservice_getanswersforinspection
- `DELETE /inspections/v1/inspections/{id}` - Delete an inspection - inspectionservice_deleteinspection
- `GET /inspections/v1/inspections/{id}` - Get an inspection - inspectionservice_getinspection
- `GET /inspections/v1/inspections/{id}/details` - Get details of an inspection - externalinspectionservice_getinspectiondetails
- `POST /inspections/v1/inspections/{inspection_id}/archive` - Archive an inspection - inspectionservice_archiveinspection
- `DELETE /inspections/v1/inspections/{inspection_id}/archive` - Restore an archived inspection - inspectionservice_restorearchivedinspection
- `POST /inspections/v1/inspections/{inspection_id}/clone` - Clone an inspection - inspectionservice_cloneinspection
- `PUT /inspections/v1/inspections/{inspection_id}/location` - Set an inspections start or finish location - inspectionservice_setinspectionlocation
- `PUT /inspections/v1/inspections/{inspection_id}/owner` - Set inspection owner - inspectionservice_setowner
- `PUT /inspections/v1/inspections/{inspection_id}/questions/{question_id}/asset` - Answer an asset field question - answerservice_answerasset
- `PUT /inspections/v1/inspections/{inspection_id}/questions/{question_id}/checkbox` - Answer a check box question - answerservice_answercheckbox
- `POST /inspections/v1/inspections/{inspection_id}/questions/{question_id}/dynamicfield` - Generate a dynamic field (repeated section) - answerservice_generatedynamicfield
- `PUT /inspections/v1/inspections/{inspection_id}/site` - Set inspection site - inspectionservice_setinspectionsite
- `DELETE /inspections/v1/inspections/{inspection_id}/user/{removed_user_id}/access` - Remove user access to an inspection - inspectionservice_removeinspectionuseraccess

## Investigations
- `POST /incidents/v1/categories` - Create Category - investigationsservice_createcategory
- `GET /incidents/v1/categories` - List Categories - investigationsservice_listcategories
- `DELETE /incidents/v1/categories/{category_id}` - Delete Category - investigationsservice_deletecategory
- `PUT /incidents/v1/categories/{category_id}` - Update Category - investigationsservice_updatecategory
- `POST /incidents/v1/categories/{category_id}/clone` - Clone Category - investigationsservice_clonecategory
- `GET /incidents/v1/categories/{category_id}/detail-fields` - List Category Detail Fields - investigationsservice_listcategorydetailfields
- `PUT /incidents/v1/categories/{category_id}/detail-fields` - Set Category Detail Fields - investigationsservice_setcategorydetailfields
- `POST /incidents/v1/detail-fields` - Create Detail Field - investigationsservice_createdetailfield
- `DELETE /incidents/v1/detail-fields/{field_id}` - Delete Detail Field - investigationsservice_deletedetailfield
- `PUT /incidents/v1/detail-fields/{field_id}` - Rename Detail Field - investigationsservice_renamedetailfield
- `PUT /incidents/v1/detail-fields/{field_id}/options` - Set Detail Field Options - investigationsservice_setdetailfieldoptions
- `GET /incidents/v1/field-library` - List Detail Field Library - investigationsservice_listdetailfieldlibrary
- `GET /incidents/v1/fields` - List Fields - investigationsservice_listfields
- `PUT /incidents/v1/fields` - Update Fields - investigationsservice_updatefields
- `POST /incidents/v1/investigations` - Create Investigation - investigationsservice_createinvestigation
- `GET /incidents/v1/investigations` - List Investigations - investigationsservice_listinvestigations
- `PUT /incidents/v1/investigations` - Update Investigations (bulk) - investigationsservice_updateinvestigations
- `DELETE /incidents/v1/investigations/{investigation_id}` - Delete Investigation - investigationsservice_deleteinvestigation
- `GET /incidents/v1/investigations/{investigation_id}` - Get Investigation - investigationsservice_getinvestigation
- `PUT /incidents/v1/investigations/{investigation_id}` - Update Investigation - investigationsservice_updateinvestigation
- `GET /incidents/v1/investigations/{investigation_id}/access` - Get Investigation Access - investigationsservice_getinvestigationaccess
- `PUT /incidents/v1/investigations/{investigation_id}/access` - Update Investigation Access - investigationsservice_updateinvestigationaccess
- `GET /incidents/v1/investigations/{investigation_id}/actions` - List Investigation Actions - investigationsservice_listinvestigationactions
- `GET /incidents/v1/investigations/{investigation_id}/actions/count` - Get Investigation Actions - investigationsservice_getinvestigationactioncount
- `GET /incidents/v1/investigations/{investigation_id}/courses` - List Investigation Courses - investigationsservice_listinvestigationcourses
- `GET /incidents/v1/investigations/{investigation_id}/courses/count` - Get Investigation Course Count - investigationsservice_getinvestigationcoursecount
- `GET /incidents/v1/investigations/{investigation_id}/inspections` - List Investigation Inspections - investigationsservice_listinvestigationinspections
- `GET /incidents/v1/investigations/{investigation_id}/inspections/count` - Get Investigation Inspection Count - investigationsservice_getinvestigationinspectioncount
- `GET /incidents/v1/investigations/{investigation_id}/issues` - List Investigation Issues - investigationsservice_listinvestigationissues
- `GET /incidents/v1/investigations/{investigation_id}/issues/count` - Get Investigation Issue Count - investigationsservice_getinvestigationissuecount
- `GET /incidents/v1/investigations/{investigation_id}/log` - List Investigation Activity - investigationsservice_listinvestigationlog
- `GET /incidents/v1/investigations/{investigation_id}/media` - List Investigation Media - investigationsservice_listinvestigationmedia
- `GET /incidents/v1/investigations/{investigation_id}/media/count` - Get Investigation Media Count - investigationsservice_getinvestigationmediacount
- `GET /incidents/v1/investigations/{investigation_id}/pdf` - Get Investigation PDF Report - investigationsservice_getinvestigationpdfreport
- `GET /incidents/v1/investigations/count` - Get Investigations Count - investigationsservice_getinvestigationscount
- `GET /incidents/v1/log` - List Settings Log Events - investigationsservice_listsettingslog
- `GET /incidents/v1/statuses` - List Statuses - investigationsservice_liststatuses
- `PUT /incidents/v1/statuses` - Update Statuses - investigationsservice_updatestatuses

## Issues
- `GET /tasks/v1/customerconfiguration/categories` - List Categories - customerconfigurationservice_getcategories
- `GET /tasks/v1/incident/{id}` - Get Issue - incidentsservice_getincidentbyid
- `POST /tasks/v1/incidents` - Create Issue (legacy) - incidentsservice_createincident
- `GET /tasks/v1/incidents/{id}` - Get Issue (legacy) - incidentsservice_getincident
- `GET /tasks/v1/incidents/{incident_id}/questions_answers` - Get Issue questions and answers - incidentsservice_getincidentquestionsandanswers
- `PUT /tasks/v1/incidents/{task_id}/asset` - Update Issue asset - incidentsservice_updateasset
- `PUT /tasks/v1/incidents/{task_id}/category` - Update Category - incidentsservice_updatecategory
- `POST /tasks/v1/incidents/{task_id}/collaborators/add` - Add Issue assignee - incidentsservice_addcollaborators
- `POST /tasks/v1/incidents/{task_id}/collaborators/remove` - Remove Issue assignee - incidentsservice_removecollaborators
- `PUT /tasks/v1/incidents/{task_id}/description` - Update Issue description - incidentsservice_updatedescription
- `PUT /tasks/v1/incidents/{task_id}/due_at` - Update Issue due date - incidentsservice_updatedueat
- `PUT /tasks/v1/incidents/{task_id}/occurred_at` - Update Issue occurred at - incidentsservice_updateoccurredat
- `GET /tasks/v1/incidents/{task_id}/pdf_report` - Export Issue to PDF - incidentsservice_getpdfreport
- `PUT /tasks/v1/incidents/{task_id}/priority` - Update Issue priority - incidentsservice_updatepriority
- `PUT /tasks/v1/incidents/{task_id}/site` - Update Issue site - incidentsservice_updatesite
- `PUT /tasks/v1/incidents/{task_id}/status` - Update Issue status - incidentsservice_updatestatus
- `PUT /tasks/v1/incidents/{task_id}/title` - Update Issue title - incidentsservice_updatetitle
- `POST /tasks/v1/incidents/delete` - Delete Issues - incidentsservice_deleteincidents
- `POST /tasks/v1/incidents/list` - List Issues - incidentsservice_getincidents
- `POST /tasks/v1/incidents/list/count` - Get count of Issues - incidentsservice_getincidentscount
- `POST /tasks/v1/incidents/submit` - Create Issue - incidentsservice_submitincident
- `POST /tasks/v1/shared_link/{task_id}/web_report` - Get Issue web report link - sharedlinkservice_generateforwebreport
- `POST /tasks/v1/timeline` - List timeline events - timelineservice_gettimeline
- `POST /tasks/v1/timeline/comments` - Add comment to timeline - timelineservice_addcomment

## Lone Worker
- `GET /loneworker/v1/jobs` - Get jobs - jobsservice_getjobs
- `GET /loneworker/v1/jobs:GetJobEvents` - Get job events - jobsservice_getjobevents

## Media
- `GET /media/v1/download/{id}` - Get media download URL - mediaservice_getdownloadsignedurl

## OSHA
- `POST /incidents/v1/osha/cases` - Create Case - oshaservice_createcase
- `GET /incidents/v1/osha/cases` - List Cases - oshaservice_listcases
- `DELETE /incidents/v1/osha/cases/{case_id}` - Delete Case - oshaservice_deletecase
- `GET /incidents/v1/osha/cases/{case_id}` - Get Case - oshaservice_getcase
- `PUT /incidents/v1/osha/cases/{case.case_id}` - Update Case - oshaservice_updatecase
- `POST /incidents/v1/osha/establishments` - Create Establishment - oshaservice_createestablishment
- `GET /incidents/v1/osha/establishments` - List Establishments - oshaservice_listestablishments
- `DELETE /incidents/v1/osha/establishments/{establishment_id}` - Delete Establishment - oshaservice_deleteestablishment
- `GET /incidents/v1/osha/establishments/{establishment_id}` - Get Establishment - oshaservice_getestablishment
- `GET /incidents/v1/osha/establishments/{establishment_id}/employees` - Get Establishment Employees - oshaservice_getestablishmentemployees
- `POST /incidents/v1/osha/establishments/{establishment_id}/employees` - Update Establishment Employees - oshaservice_updateestablishmentemployees
- `GET /incidents/v1/osha/establishments/{establishment_id}/hours` - Get Establishment Hours - oshaservice_getestablishmenthours
- `POST /incidents/v1/osha/establishments/{establishment_id}/hours` - Update Establishment Hours - oshaservice_updateestablishmenthours
- `PUT /incidents/v1/osha/establishments/{establishment.establishment_id}` - Update Establishment - oshaservice_updateestablishment

## Response Sets
- `POST /response_sets` - Create a global response set - thepubservice_createglobalresponseset
- `DELETE /response_sets/{id}` - Delete a global response set - thepubservice_deleteglobalresponseset
- `GET /response_sets/{id}` - Get a global response set - thepubservice_getglobalresponseset
- `PUT /response_sets/{id}` - Update a global response set - thepubservice_updateglobalresponseset
- `POST /response_sets/{id}/responses` - Create a global response set response - thepubservice_creategrsresponse
- `DELETE /response_sets/{id}/responses/{response_id}` - Delete a global response set response - thepubservice_deletegrsresponse
- `PUT /response_sets/{id}/responses/{response_id}` - Update a global response set response - thepubservice_updategrsresponse
- `GET /response_sets/v2` - List global response sets - thepubservice_listallglobalresponsesets

## Roles
- `POST /permissions/v1/roles` - Create a role - rolesservice_createrole
- `GET /permissions/v1/roles/{role_id}` - Get a role - rolesservice_getrole
- `PUT /permissions/v1/roles/{role.id}` - Update a role - rolesservice_updaterole

## Schedules
- `GET /scheduling/v1/schedule_targets/{schedule_id}` - List schedule targets - schedulingservice_listscheduletargets
- `POST /scheduling/v1/schedules` - Create a new schedule - schedulingservice_createnewschedule
- `DELETE /scheduling/v1/schedules/{id}` - Delete a schedule - schedulingservice_deleteschedule
- `PATCH /scheduling/v1/schedules/{id}/end` - End a schedule - schedulingservice_endschedule
- `PATCH /scheduling/v1/schedules/{id}/pause` - Pause a schedule - schedulingservice_pauseschedule
- `PATCH /scheduling/v1/schedules/{id}/resume` - Resume a schedule - schedulingservice_resumeschedule
- `GET /scheduling/v1/schedules/{schedule_id}` - Get a schedule - schedulingservice_getschedule
- `GET /scheduling/v1/schedules/{schedule_id}/access` - List schedule access - schedulingservice_listscheduleaccess
- `PATCH /scheduling/v1/schedules/{schedule_id}/assignees` - Update schedule assignees - schedulingservice_updatescheduleassignees
- `PATCH /scheduling/v1/schedules/{schedule_id}/details` - Update schedule details - schedulingservice_updatescheduledetails
- `PATCH /scheduling/v1/schedules/{schedule_id}/recurrence` - Update schedule recurrence - schedulingservice_updateschedulerecurrence
- `PATCH /scheduling/v1/schedules/{schedule_id}/target` - Update schedule target - schedulingservice_updatescheduletarget

## Schedules (legacy)
- `POST /schedules/v1/schedule_items` - Create a schedule item - schedulesservice_createscheduleitem
- `GET /schedules/v1/schedule_items` - List schedule items - schedulesservice_listscheduleitems
- `DELETE /schedules/v1/schedule_items/{id}` - Delete a schedule item - schedulesservice_deletescheduleitem
- `PUT /schedules/v1/schedule_items/{id}` - Update a schedule item - schedulesservice_updatescheduleitem

## Sensors
- `GET /sensors/v1/sensors/{source_name}/{source_id}/details` - Get sensor - sensorsservice_getsensor
- `GET /sensors/v1/sensors/{source_name}/{source_id}/latest-readings` - Get sensor's latest readings - sensorsservice_getsensorlatestreadings
- `DELETE /sensors/v1/sensors/deprovision/{source_name}/{source_id}` - De-provision a sensor - sensorsservice_deprovisionsensor
- `POST /sensors/v1/sensors/ingest-readings` - Ingest sensor readings - sensorsservice_ingestsensorreadings
- `POST /sensors/v1/sensors/list` - List sensors - sensorsservice_listsensors
- `POST /sensors/v1/sensors/provision` - Provision a sensor - sensorsservice_provisionsensor
- `GET /sensors/v1/sensors/sensor-id/{device_id}` - Get a sensor ID - sensorsservice_getsensorid

## Structures
- `POST /structures/v1/fields/list` - List fields - structuresfieldsservice_listfields
- `POST /structures/v1/roles/{role_id}/members` - Add users to a role - structuremembershipservice_adduserstorole
- `POST /structures/v1/roles/{role_id}/members/list` - List users by role - structuremembershipservice_listusersbyrole
- `POST /structures/v1/structures` - Create a structure - structuresservice_createstructure
- `GET /structures/v1/structures/{structure_id}` - Get a structure - structuresservice_getstructureprofile
- `PUT /structures/v1/structures/{structure_id}` - Replace a structure - structuresservice_updatestructure
- `POST /structures/v1/structures/{structure_id}/members` - Add users to a structure - structuremembershipservice_adduserstostructure
- `POST /structures/v1/structures/{structure_id}/members/list` - List members of a structure - structuremembershipservice_listdirectusersinstructure
- `POST /structures/v1/structures/{structure_id}/members/remove` - Remove users from a structure - structuremembershipservice_removeusersfromstructure
- `GET /structures/v1/structures/{structure_id}/metadata` - Get structure metadata - structuresservice_getstructuremetadata
- `POST /structures/v1/structures/{structure_id}/move` - Move a structure - structuresservice_movestructure
- `POST /structures/v1/structures/search` - Search structures - structuresservice_searchstructures

## Templates
- `GET /templates/integration/v1/templates/{template_id}/definition` - Get template definition - templateservice_gettemplatedefinition
- `POST /templates/integration/v1/templates/{template_id}/draft` - Open a template draft - templateservice_createtemplatedraft
- `DELETE /templates/integration/v1/templates/{template_id}/draft` - Discard a template draft - templateservice_discardtemplatedraft
- `GET /templates/integration/v1/templates/{template_id}/draft` - Get template draft - templateservice_gettemplatedraft
- `PUT /templates/integration/v1/templates/{template_id}/draft` - Update a template draft - templateservice_updatetemplatedraft
- `POST /templates/integration/v1/templates/{template_id}/publish` - Publish a template draft - templateservice_publishtemplate
- `GET /templates/search` - Search modified templates - thepubservice_searchtemplates
- `DELETE /templates/v1/templates/{template_id}` - Delete a template by template ID - templatesservice_deletetemplatebyid
- `GET /templates/v1/templates/{template_id}` - Get a template - templatesservice_gettemplatebyid
- `POST /templates/v1/templates/{template_id}/archive` - Archive a template - templatesservice_archivetemplate
- `DELETE /templates/v1/templates/{template_id}/archive` - Restore an archived template - templatesservice_restorearchivedtemplate
- `GET /templates/v1/templates/inspections/{inspection_id}` - Get template (by inspection) - templatesservice_gettemplatebyinspectionid

## Training
- `GET /training/analytics/v1/courses/statistics` - Get Course Statistics - traininganalyticsservice_getcoursestatistics
- `GET /training/analytics/v1/lessons/attempts` - Get Lesson Attempts - traininganalyticsservice_getlessonattempts
- `GET /training/analytics/v1/lessons/progress/events` - Get Lesson Progress Events - traininganalyticsservice_getlessonprogressevents
- `GET /training/analytics/v1/lessons/statistics` - Get Lesson Statistics - traininganalyticsservice_getlessonstatistics
- `GET /training/analytics/v1/rapidRefresh/answers` - Get Rapid Refresh Answers - traininganalyticsservice_getrapidrefreshanswers
- `GET /training/analytics/v1/slides/statistics` - Get Slide Statistics - traininganalyticsservice_getslidestatistics
- `GET /training/analytics/v1/surveys/answers` - Get Survey Answers - traininganalyticsservice_getsurveyanswers
- `GET /training/analytics/v1/surveys/questionDefinitions` - Get Survey Question Definitions - traininganalyticsservice_getsurveyquestiondefinitions
- `GET /training/analytics/v1/users/{userId}/lessons/progress` - Get User Lesson Progress - traininganalyticsservice_getuserlessonprogress
- `GET /training/analytics/v1/users/{userId}/lessons/progress/events` - Get User Lesson Progress Events - traininganalyticsservice_getuserlessonprogressevents
- `GET /training/analytics/v1/users/{userId}/slides/statistics` - Get Slide User Statistics - traininganalyticsservice_getslideuserstatistics
- `GET /training/collections/v1` - Get collections - trainingcollectionsservice_getcoursecollections
- `GET /training/collections/v1/{courseCollectionId}/courses` - Get courses by collection - trainingcollectionsservice_getcoursesbycoursecollectionid
- `POST /training/courseprogress/v1/reset` - Reset course progress - trainingcourseprogressservice_resetcourseprogress
- `GET /training/courses/v1` - Get courses - trainingcoursesservice_getcourses
- `PUT /training/courses/v1/{courseId}/assignments` - Update course assignments - trainingcoursesservice_updatecourseassignments
- `GET /training/courses/v1/{courseId}/lessons` - Get lessons by course ID - trainingcoursesservice_getlessonsbycourseid
- `GET /training/individualleaderboards/v1` - Get individual leaderboards - trainingindividualleaderboardsservice_getindividualleaderboards
- `GET /training/individualleaderboards/v1/rankings` - Get individual leaderboard rankings - trainingindividualleaderboardsservice_getindividualleaderboardrankings
- `GET /training/lessons/v1/{id}` - Get lesson by ID - traininglessonsservice_getlessonbyid
- `GET /training/paths/v1` - Get paths - trainingpathsservice_getpaths
- `GET /training/paths/v1/{pathId}` - Get path by ID - trainingpathsservice_getpathbyid
- `GET /training/rapid-refresh/v1` - Get rapid refresh - trainingrapidrefreshservice_getrapidrefresh
- `GET /training/rapid-refresh/v1/{id}` - Get rapid refresh by ID - trainingrapidrefreshservice_getrapidrefreshbyid

## Users
- `GET /permissions/v1/permission_set/{id}` - Get a permission set - permissionsservice_getpermissionset
- `POST /permissions/v1/permission_set/assign` - Assign user to a permission set - permissionsservice_assignpermissionset
- `POST /permissions/v1/permission_sets` - List permission sets - permissionsservice_listpermissionsets
- `POST /users` - Create a user (legacy) - thepubservice_adduser
- `GET /users/{user_id}` - Get a user (legacy) - thepubservice_getuser
- `PUT /users/{user_id}` - Update a user (legacy) - thepubservice_updateuser
- `POST /users/search` - List users by email (legacy) - thepubservice_searchusers
- `POST /users/v1/fields` - Create a user field - userfieldservice_createfield
- `DELETE /users/v1/fields/{id}` - Delete a user field - userfieldservice_deletefield
- `PATCH /users/v1/fields/{id}` - Update a user field - userfieldservice_updatefield
- `POST /users/v1/fields/{id}/disable` - Archive a field - userfieldservice_disablefield
- `POST /users/v1/fields/{id}/restore` - Restore an archived field - userfieldservice_restorefield
- `POST /users/v1/fields/{id}/settings` - Update field settings - userfieldservice_setfieldsettings
- `POST /users/v1/fields/list` - List user fields - userfieldservice_listfields
- `GET /users/v1/users/{user_id}/attributes` - Get user attributes - userattributeservice_getuserattributes
- `POST /users/v1/users/{user_id}/attributes` - Set user attributes - userattributeservice_setuserattributes
- `POST /users/v1/users/list` - List users - usersservice_listusers

## Webhooks
- `POST /webhooks/v1/token` - Regenerate signature secret - webhooksservice_generatetoken
- `GET /webhooks/v1/token` - Get signature secret - webhooksservice_gettoken
- `POST /webhooks/v1/webhooks` - Create a webhook - webhooksservice_createwebhook
- `GET /webhooks/v1/webhooks` - List webhooks - webhooksservice_listwebhooks
- `DELETE /webhooks/v1/webhooks/{webhook_id}` - Delete a webhook - webhooksservice_deletewebhook
- `GET /webhooks/v1/webhooks/{webhook_id}` - Get a webhook - webhooksservice_getwebhook
- `PUT /webhooks/v1/webhooks/{webhook_id}` - Update a webhook - webhooksservice_updatewebhook
