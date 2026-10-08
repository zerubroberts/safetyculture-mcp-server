# Live API response shapes (key names + JSON types only)

Captured 2026-10-08 from a test org with scripts/probe-shape.mjs. No values recorded.

## GET /feed/inspection_items
```json
{
 "metadata": {
  "next_page": "string",
  "remaining_records": "number"
 },
 "data": [
  {
   "id": "string",
   "item_id": "string",
   "audit_id": "string",
   "item_index": "number",
   "template_id": "string",
   "parent_id": "object",
   "organisation_id": "string",
   "created_at": "string",
   "modified_at": "string",
   "type": "string",
   "category": "string",
   "category_id": "string",
   "parent_ids": "string",
   "primeelement_id": "object",
   "primeelement_index": "object",
   "label": "string",
   "response": "string",
   "response_id": "object",
   "response_set_id": "object",
   "is_failed_response": "boolean",
   "comment": "object",
   "media_files": "string",
   "media_ids": "string",
   "media_hypertext_reference": "string",
   "score": "number",
   "max_score": "number",
   "score_percentage": "number",
   "combined_score": "number",
   "combined_max_score": "number",
   "combined_score_percentage": "number",
   "mandatory": "boolean",
   "inactive": "boolean",
   "location_latitude": "object",
   "location_longitude": "object"
  }
 ]
}
```
## GET /feed/sites
```json
{
 "metadata": {
  "next_page": "string",
  "next_page_token": "string",
  "locations_enabled": "boolean",
  "remaining_records": "number"
 },
 "data": [
  {
   "id": "string",
   "name": "string",
   "creator_id": "string",
   "organisation_id": "string",
   "deleted": "boolean",
   "site_uuid": "string",
   "meta_label": "string",
   "parent_id": "string"
  }
 ]
}
```
## GET /feed/users
```json
{
 "metadata": {
  "next_page": "object",
  "next_page_token": "object",
  "remaining_records": "number"
 },
 "data": [
  {
   "id": "string",
   "organisation_id": "string",
   "email": "string",
   "firstname": "string",
   "lastname": "string",
   "active": "boolean",
   "last_seen_at": "string",
   "seat_type": "string",
   "created_at": "string"
  }
 ]
}
```
## GET /feed/groups
```json
{
 "metadata": {
  "next_page": "object",
  "next_page_token": "object",
  "remaining_records": "number"
 },
 "data": [
  {
   "id": "string",
   "organisation_id": "string",
   "name": "string"
  }
 ]
}
```
## GET /feed/group_users
```json
{
 "metadata": {
  "next_page": "object",
  "next_page_token": "object",
  "remaining_records": "number"
 },
 "data": [
  {
   "user_id": "string",
   "group_id": "string",
   "organisation_id": "string"
  }
 ]
}
```
## GET /feed/templates
```json
{
 "metadata": {
  "next_page": "string",
  "remaining_records": "number"
 },
 "data": [
  {
   "id": "string",
   "archived": "boolean",
   "name": "string",
   "description": "string",
   "owner_name": "string",
   "owner_id": "string",
   "author_name": "string",
   "author_id": "string",
   "organisation_id": "string",
   "created_at": "string",
   "modified_at": "string"
  }
 ]
}
```
## GET /feed/schedules
```json
{
 "metadata": {
  "next_page": "object",
  "next_page_token": "object",
  "remaining_records": "number"
 },
 "data": []
}
```
## GET /feed/schedule_occurrences
```json
{
 "metadata": {
  "next_page": "object",
  "remaining_records": "number"
 },
 "data": []
}
```
## GET /feed/schedule_assignees
```json
{
 "metadata": {
  "next_page": "object",
  "remaining_records": "number"
 },
 "data": []
}
```
## GET /feed/assets
```json
{
 "metadata": {
  "next_page": "string",
  "next_page_token": "string"
 },
 "data": [
  {
   "id": "string",
   "code": "string",
   "type_id": "string",
   "type_name": "string",
   "fields": "string",
   "created_at": "string",
   "modified_at": "string",
   "site_id": "object",
   "state": "string",
   "status_options": "string"
  }
 ]
}
```
## GET /feed/action_assignees
```json
{
 "metadata": {
  "next_page": "string",
  "next_page_token": "string",
  "remaining_records": "number"
 },
 "data": [
  {
   "id": "string",
   "action_id": "string",
   "assignee_id": "string",
   "name": "string",
   "organisation_id": "string",
   "modified_at": "string",
   "type": "string"
  }
 ]
}
```
## GET /feed/action_timeline_items
```json
{
 "metadata": {
  "next_page": "string",
  "remaining_records": "number"
 },
 "data": [
  {
   "id": "string",
   "task_id": "string",
   "organisation_id": "string",
   "task_creator_id": "string",
   "task_creator_name": "string",
   "timestamp": "string",
   "creator_id": "string",
   "creator_name": "string",
   "item_type": "string",
   "item_data": "string"
  }
 ]
}
```
## GET /feed/issue_timeline_items
```json
{
 "metadata": {
  "next_page": "string",
  "next_page_token": "string"
 },
 "data": [
  {
   "id": "string",
   "task_id": "string",
   "organisation_id": "string",
   "task_creator_id": "string",
   "task_creator_name": "string",
   "timestamp": "string",
   "creator_id": "string",
   "creator_name": "string",
   "item_type": "string",
   "item_data": "string"
  }
 ]
}
```
## GET /feed/site_members
```json
{
 "metadata": {
  "next_page": "object",
  "next_page_token": "object",
  "remaining_records": "number"
 },
 "data": []
}
```
## GET /feed/template_permissions
```json
{
 "metadata": {
  "next_page": "string",
  "next_page_token": "string",
  "remaining_records": "number"
 },
 "data": [
  {
   "id": "string",
   "template_id": "string",
   "permission": "string",
   "assignee_type": "string",
   "assignee_id": "string",
   "organisation_id": "string"
  }
 ]
}
```
## GET /feed/activity_log_events?limit=1
```json
GET /feed/activity_log_events?limit=1 200 x-ratelimit-limit=null x-ratelimit-remaining=null x-ratelimit-reset=null
{
 "metadata": {
  "next_page": "string",
  "next_page_token": "string"
 },
 "data": [
  {
   "id": "string",
   "event_at": "string",
   "type": "string",
   "user_id": "string",
   "organisation_id": "string",
   "client_class": "string",
   "agent": "string",
   "metadata": "string",
   "remote_ip": "string",
   "initiator": "string"
  }
 ]
}
```
## GET /schedules/v1/schedule_items?page_size=1
```json
GET /schedules/v1/schedule_items?page_size=1 200 x-ratelimit-limit=null x-ratelimit-remaining=null x-ratelimit-reset=null
{
 "items": [],
 "next_page_token": "object",
 "total": "number"
}
```
## GET /assets/v1/assets/list
```json
GET /assets/v1/assets/list 400 x-ratelimit-limit=null x-ratelimit-remaining=null x-ratelimit-reset=null
{
 "code": "number",
 "message": "string",
 "details": []
}
```
## GET /directory/v1/folders?page_size=1
```json
GET /directory/v1/folders?page_size=1 200 x-ratelimit-limit=null x-ratelimit-remaining=null x-ratelimit-reset=null
{
 "folders": [
  {
   "id": "string",
   "name": "string",
   "org_id": "string",
   "creator_id": "string",
   "created_at": "string",
   "modified_at": "string",
   "meta_label": "string",
   "members_count": "number",
   "deleted": "boolean",
   "managers_count": "number",
   "is_dynamic": "boolean"
  }
 ],
 "next_page_token": "string",
 "folders_with_ancestors": [],
 "folders_enabled": "boolean"
}
```
## GET /templates/v1/templates/search?page_size=1
```json
GET /templates/v1/templates/search?page_size=1 200 x-ratelimit-limit=null x-ratelimit-remaining=null x-ratelimit-reset=null
{
 "next_page_token": "string",
 "items": [
  {
   "id": "string",
   "name": "string",
   "modified_at": "string",
   "image": "object",
   "permissions": "object",
   "access_level": "string"
  }
 ]
}
```
## GET /training/courses/v1?page_size=1
```json
GET /training/courses/v1?page_size=1 200 x-ratelimit-limit=null x-ratelimit-remaining=null x-ratelimit-reset=null
{
 "totalCount": "number",
 "items": [
  {
   "id": "string",
   "externalId": "string",
   "title": "string",
   "description": "string",
   "status": "string",
   "locale": "string",
   "isMandatory": "boolean",
   "dueBy": "string",
   "duration": "number",
   "thumbnailUrl": "string",
   "createdDatetime": "string",
   "modifiedDatetime": "string",
   "TranslationOriginalCourse": {
    "id": "string",
    "externalId": "string"
   },
   "logoUrl": "string",
   "brandingImageUrl": "string",
   "isPublished": "boolean",
   "LessonCount": "number",
   "publishedVersionNumber": "number"
  }
 ]
}
```
## GET /incidents/v1/categories
```json
GET /incidents/v1/categories 200 x-ratelimit-limit=null x-ratelimit-remaining=null x-ratelimit-reset=null
{
 "results": [
  {
   "category_id": "string",
   "created_at": "string",
   "modified_at": "string",
   "title": "string",
   "description": "string",
   "total_investigation_count": "number"
  }
 ]
}
```
## GET /tasks/v1/customer_configuration/action_labels
```json
GET /tasks/v1/customer_configuration/action_labels 200 x-ratelimit-limit=null x-ratelimit-remaining=null x-ratelimit-reset=null
{
 "labels": [
  {
   "label_id": "string",
   "label_name": "string"
  }
 ]
}
```
