package com.markcamp.backend.user;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

// Repository, not JpaRepository: save() on an entity with an assigned id is a merge, i.e. an upsert (ADR 0002).
public interface UserRepository extends Repository<User, UUID> {

	@Query("select u.id from User u where u.authProvider = :provider and u.authSubject = :subject")
	Optional<UUID> findIdByAuthIdentity(AuthProvider provider, String subject);

	/**
	 * Inserts the user unless one with the same provider identity exists. Returns the number of rows inserted (0 or 1).
	 */
	@Modifying
	@Query(nativeQuery = true, value = """
			INSERT INTO users (id, auth_provider, auth_subject)
			VALUES (:id, :provider, :subject)
			ON CONFLICT (auth_provider, auth_subject) DO NOTHING
			""")
	int insertIfAbsent(UUID id, String provider, String subject);

}
