package com.markcamp.backend.project;

import java.util.List;

/**
 * An object, not a bare array: pagination can be added later as a new field without breaking old clients.
 */
record ProjectListResponse(List<ProjectResponse> items) {
}
