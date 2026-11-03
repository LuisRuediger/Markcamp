package com.markcamp.backend.project;

import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * The single project access check (ADR 0001, rule 2). Roles come from project_members, never from the token.
 */
@Component
public class ProjectAccess {

	private static final Logger log = LoggerFactory.getLogger(ProjectAccess.class);

	private final ProjectMemberRepository memberRepository;

	ProjectAccess(ProjectMemberRepository memberRepository) {
		this.memberRepository = memberRepository;
	}

	/**
	 * One query, no "does the project exist?" step: a missing project and a non-member take the same code path.
	 */
	public ProjectMembership requireMember(UUID userId, UUID projectId) {
		ProjectRole role = this.memberRepository.findRole(projectId, userId).orElseThrow(() -> {
			log.warn("Project access denied: userId={} projectId={}", userId, projectId);
			return new ProjectNotFoundException();
		});
		return new ProjectMembership(projectId, userId, role);
	}

}
