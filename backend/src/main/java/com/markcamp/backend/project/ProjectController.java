package com.markcamp.backend.project;

import java.net.URI;
import java.util.UUID;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.markcamp.backend.auth.AuthenticatedUser;

@RestController
class ProjectController {

	private final ProjectService projectService;

	ProjectController(ProjectService projectService) {
		this.projectService = projectService;
	}

	@PostMapping("/api/projects")
	ResponseEntity<ProjectResponse> create(@AuthenticationPrincipal AuthenticatedUser user,
			@RequestBody CreateProjectRequest request) {
		ProjectResponse project = this.projectService.create(user.id(), request.validate());
		return ResponseEntity.created(URI.create("/api/projects/" + project.id())).body(project);
	}

	@GetMapping("/api/projects")
	ProjectListResponse list(@AuthenticationPrincipal AuthenticatedUser user) {
		return new ProjectListResponse(this.projectService.list(user.id()));
	}

	@GetMapping("/api/projects/{id}")
	ProjectResponse get(@AuthenticationPrincipal AuthenticatedUser user, @PathVariable UUID id) {
		return this.projectService.get(user.id(), id);
	}

}
