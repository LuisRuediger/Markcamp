package com.markcamp.backend.project;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

// Repository, not JpaRepository: save() on an entity with an assigned id is a merge, i.e. an upsert (ADR 0002).
interface ProjectRepository extends Repository<Project, UUID> {

	Optional<Project> findById(UUID id);

	@Query("""
			select new com.markcamp.backend.project.ProjectRow(p.id, p.name, m.role, p.createdAt)
			from Project p
			join ProjectMember m on m.projectId = p.id
			where m.userId = :userId
			order by p.createdAt, p.id
			""")
	List<ProjectRow> findAllOfUser(UUID userId);

	/**
	 * Inserts the project unless the id is taken. Returns the number of rows inserted (0 or 1).
	 */
	@Modifying
	@Query(nativeQuery = true, value = """
			INSERT INTO projects (id, name, created_by)
			VALUES (:id, :name, :createdBy)
			ON CONFLICT (id) DO NOTHING
			""")
	int insertIfAbsent(UUID id, String name, UUID createdBy);

}
