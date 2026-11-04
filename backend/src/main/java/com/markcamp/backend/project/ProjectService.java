package com.markcamp.backend.project;

import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.markcamp.backend.common.IdAlreadyExistsException;
import com.markcamp.backend.common.UuidV7;

@Service
class ProjectService {

	private static final Logger log = LoggerFactory.getLogger(ProjectService.class);

	private final ProjectRepository projectRepository;

	private final ProjectMemberRepository memberRepository;

	private final ProjectAccess projectAccess;

	ProjectService(ProjectRepository projectRepository, ProjectMemberRepository memberRepository,
			ProjectAccess projectAccess) {
		this.projectRepository = projectRepository;
		this.memberRepository = memberRepository;
		this.projectAccess = projectAccess;
	}

	@Transactional
	ProjectResponse create(UUID userId, CreateProjectRequest.Validated request) {
		// ON CONFLICT DO NOTHING, not catching a unique violation: in Postgres an error aborts the whole transaction,
		// and a taken id is an expected outcome here, not a failure (ADR 0006, rule 3).
		if (this.projectRepository.insertIfAbsent(request.id(), request.name(), userId) == 0) {
			throw new IdAlreadyExistsException();
		}
		this.memberRepository.insert(UuidV7.generate(), request.id(), userId, ProjectRole.OWNER.name());
		log.info("Project created: projectId={} userId={}", request.id(), userId);
		// Read back because the database sets created_at.
		return toResponse(this.projectRepository.findById(request.id()).orElseThrow(), ProjectRole.OWNER);
	}

	List<ProjectResponse> list(UUID userId) {
		return this.projectRepository.findAllOfUser(userId)
			.stream()
			.map((row) -> new ProjectResponse(row.id(), row.name(), row.role(), row.createdAt()))
			.toList();
	}

	@Transactional(readOnly = true)
	ProjectResponse get(UUID userId, UUID projectId) {
		ProjectMembership membership = this.projectAccess.requireMember(userId, projectId);
		Project project = this.projectRepository.findById(membership.projectId())
			.orElseThrow(ProjectNotFoundException::new);
		return toResponse(project, membership.role());
	}

	private static ProjectResponse toResponse(Project project, ProjectRole role) {
		return new ProjectResponse(project.getId(), project.getName(), role, project.getCreatedAt());
	}

}
