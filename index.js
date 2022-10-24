const { ApolloServer } = require('apollo-server')
const mongoose = require('mongoose')
const { GraphQLScalarType, Kind } = require('graphql')
const jwt_decode = require('jwt-decode')

require('dotenv').config()

const typeDefs = require('./gql/typeDefs')
const { Query, Mutation } = require('./gql/resolvers')

const dateScalar = new GraphQLScalarType({
    name: 'Date',
    description: 'Date custom scalar type',
    serialize(value) {
        return value.getTime() // Convert outgoing Date to integer for JSON
    },
    parseValue(value) {
        return new Date(value) // Convert incoming integer to Date
    },
    parseLiteral(ast) {
        if (ast.kind === Kind.INT) {
            return new Date(parseInt(ast.value, 10)) // Convert hard-coded AST string to integer and then to Date
        }
        return null // Invalid hard-coded value (not an integer)
    }
})

module.exports.dateScalar = dateScalar

const PORT = process.env.PORT || 5001
const MONGO_URI = process.env.MONGODB ?? ''
const server = new ApolloServer({
    typeDefs,
    resolvers: { Query, Mutation, Date: dateScalar },
    cors: true,
    introspection: true,
    context: ({ req }) => {
        const encodedToken = req.headers?.authorization
        if (encodedToken) {
            const tokenString = encodedToken
                ? encodedToken.split('Bearer')[1]
                : ''
            const user = jwt_decode(tokenString)
            return { req, user }
        }

        return { req, user: null }
    }
})

mongoose
    .connect(MONGO_URI)
    .then(() => {
        console.log('MongoDB Connected')
        return server.listen({ port: PORT })
    })
    .then(res => {
        console.log(`Server running on ${res.url}`)
    })
    .catch(err => console.error(err))
