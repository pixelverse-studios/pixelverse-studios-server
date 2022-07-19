import { gql } from 'apollo-server'

const typeDefs = gql`
    scalar Date

    type User {
        id: ID!
        email: String!
        password: String!
        firstName: String
        lastName: String
        token: String
    }

    type Query {
        # USERS
        getUser(email: String!): User
        getAllUsers: [User]
        getLoggedInUser: User!
    }

    type Mutation {
        # USERS
        register(email: String!, password: String!): User!
        login(email: String!, password: String!): User!
        updateUser(firstName: String, lastName: String, email: String!): User!
        updatePassword(email: String!, newPassword: String!): User!
        deleteUser(id: String!): [User]
        sendPasswordResetEmail(email: String!): [User]
    }
`

export default typeDefs
