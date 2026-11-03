package com.markcamp.backend.project;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

// Package-private: other features go through ProjectAccess, they cannot read roles on their own (ADR 0001, rule 2).
interface ProjectMemberRepository extends Repository<ProjectMember, UUID> {

	@Query("select m.role from ProjectMember m where m.projectId = :projectId and m.userId = :userId")
	Optional<ProjectRole> findRole(UUID projectId, UUID userId);

	@Modifying
	@Query(nativeQuery = true, value = """
			INSERT INTO project_members (id, project_id, user_id, role)
			VALUES (:id, :projectId, :userId, :role)
			""")
	int insert(UUID id, UUID projectId, UUID userId, String role);

}
